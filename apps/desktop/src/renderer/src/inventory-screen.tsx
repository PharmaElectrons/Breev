import {
  INVENTORY_COLUMN_FIELDS,
  normalizeIndicDigits,
  type IdentityDenial,
  type InventoryColumnField,
  type InventoryDenial,
  type InventoryItem,
  type InventoryRiskIndicator,
  type Product,
  type InventoryMovement,
  type LicensingDenial,
} from "@breev/contracts/local-rest";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCommittedFocus } from "./committed-focus";

import {
  InventoryApiDenied,
  addReorderItem,
  exportInventorySensitiveData,
  inventoryCommandAttempt,
  newInventoryIdempotencyKey,
  readBatchSafetyStatus,
  readReorderBasket,
  requestInventoryItems,
  requestInventoryMovements,
  requestInventoryReviewPreferences,
  updateInventoryReviewPreferences,
} from "./inventory-api";
import { BatchSafetyReview } from "./batch-safety-review";
import { BatchSafetyPanel } from "./batch-safety-panel";
import { basketMessages } from "./basket-messages";
import { requestProduct, searchProducts } from "./catalog-api";
import {
  PurchaseItemPanel,
  type PurchaseItemSelection,
} from "./purchase-item-details";
import { inventoryMessages, type InventoryCopy } from "./inventory-messages";
import { createInventoryPreferenceSaveQueue } from "./inventory-preferences-save";
import { useIdentityState } from "./identity-state-provider";
import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
import { identityMessages } from "./identity-messages";
import { licensingMessages } from "./licensing-messages";
import { MoneyAmount } from "./money-amount";
import { panelUnitLabel } from "./panel-unit-label";
import { usePreferences } from "./preferences-provider";
import {
  formatCurrencyFromFils,
  formatDate,
  formatNumber,
  formatTime,
} from "./preferences";
import { PostedPurchaseReview } from "./posted-purchase-review";
import { CountSessionReview } from "./count-session-review";
import { CountSessionScreen } from "./count-session-screen";
import { StateIndicator } from "./state-indicator";
import { StepUpDialog, useStepUp } from "./step-up";

type SortDirection = "ascending" | "descending";
type SortState = {
  readonly field: InventoryColumnField;
  readonly direction: SortDirection;
};
type ReviewDenial = IdentityDenial | InventoryDenial | LicensingDenial;

async function collectCatalogSearchIds(
  baseUrl: string,
  query: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const page = await searchProducts(baseUrl, {
      limit: "100",
      offset: String(offset),
      query,
    });
    for (const { product } of page.results) ids.add(product.id);
    if (!page.hasMore || page.results.length === 0) {
      hasMore = false;
    } else {
      offset += page.results.length;
    }
  }
  return ids;
}

const DEFAULT_COLUMNS = INVENTORY_COLUMN_FIELDS.map((field) => ({
  field,
  visible: true,
}));

export function InventoryRouteView({
  baseUrl,
  checkNow,
  hash,
}: {
  readonly baseUrl: string;
  readonly checkNow: () => Promise<void>;
  readonly hash: string;
}): React.JSX.Element {
  const route = inventoryRoute(hash);
  const { state: identity } = useIdentityState();
  const canRecordCount =
    identity?.state === "authenticated" &&
    identity.allowedPermissions.includes("inventory.counts.record");
  const canApproveCount =
    identity?.state === "authenticated" &&
    identity.allowedPermissions.includes("inventory.counts.approve");
  const canReviewInventory =
    identity?.state === "authenticated" &&
    identity.allowedPermissions.includes("inventory.review");
  const canManageReorder =
    identity?.state === "authenticated" &&
    identity.allowedPermissions.includes("inventory.reorder.manage");
  if (route.kind === "count") {
    return (
      <CountSessionScreen
        baseUrl={baseUrl}
        canApprove={canApproveCount}
        canRecord={canRecordCount}
        canReviewInventory={canReviewInventory}
        checkNow={checkNow}
        mode="start"
      />
    );
  }
  if (route.kind === "count-session") {
    return (
      <CountSessionScreen
        baseUrl={baseUrl}
        canApprove={canApproveCount}
        canRecord={canRecordCount}
        canReviewInventory={canReviewInventory}
        checkNow={checkNow}
        mode="loop"
        sessionId={route.sessionId}
      />
    );
  }
  if (route.kind === "movements") {
    return (
      <InventoryMovements
        baseUrl={baseUrl}
        checkNow={checkNow}
        productId={route.productId}
        documentId={route.documentId}
        documentType={route.documentType}
      />
    );
  }
  if (route.kind === "safety-review") {
    return (
      <BatchSafetyReview
        baseUrl={baseUrl}
        checkNow={checkNow}
        month={route.month}
      />
    );
  }
  if (!canRecordCount && !canApproveCount) {
    return (
      <InventoryScreen
        baseUrl={baseUrl}
        canManageReorder={canManageReorder}
        checkNow={checkNow}
      />
    );
  }
  if (!canReviewInventory) {
    return (
      <CountSessionScreen
        baseUrl={baseUrl}
        canApprove={canApproveCount}
        canRecord={canRecordCount}
        canReviewInventory={canReviewInventory}
        checkNow={checkNow}
        mode="start"
      />
    );
  }
  return (
    <InventoryScreen
      baseUrl={baseUrl}
      canManageReorder={canManageReorder}
      checkNow={checkNow}
    />
  );
}

function InventoryScreen({
  baseUrl,
  canManageReorder,
  checkNow,
}: {
  readonly baseUrl: string;
  readonly canManageReorder: boolean;
  readonly checkNow: () => Promise<void>;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = inventoryMessages[locale];
  const { state: identity } = useIdentityState();
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [safetyStatus, setSafetyStatus] = useState<Awaited<
    ReturnType<typeof readBatchSafetyStatus>
  > | null>(null);
  const [valuation, setValuation] = useState<"granted" | "denied">("denied");
  const [preferences, setPreferences] = useState({
    columns: DEFAULT_COLUMNS,
    revision: "1",
  });
  const [error, setError] = useState<string | null>(null);
  const [denial, setDenial] = useState<ReviewDenial | null>(null);
  const [stepUpDenial, setStepUpDenial] = useState<
    (IdentityDenial | LicensingDenial) | null
  >(null);
  const [announcement, setAnnouncement] = useState("");
  const [basketFeedback, setBasketFeedback] = useState("");
  const [basketCount, setBasketCount] = useState<number | null>(null);
  const [addingProductId, setAddingProductId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  );
  const [panelProduct, setPanelProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIds, setSearchIds] = useState<ReadonlySet<string> | null>(null);
  const [searchDegraded, setSearchDegraded] = useState(false);
  const searchSequenceRef = useRef(0);
  const basketRevisionRef = useRef(0);
  const [sort, setSort] = useState<SortState>({
    direction: "ascending",
    field: "item",
  });
  const [exportStatus, setExportStatus] = useState<
    "cancelled" | "export-too-large" | "failed" | "idle" | "saved"
  >("idle");
  const [preferenceNotice, setPreferenceNotice] = useState<string | null>(null);
  const settingsToggleRef = useRef<HTMLElement>(null);
  const requestCommittedFocus = useCommittedFocus();
  const reorderAttemptRef = useRef<ReturnType<
    typeof inventoryCommandAttempt
  > | null>(null);
  const latestPreferenceRevisionRef = useRef(preferences.revision);
  const latestPreferenceColumnsRef = useRef(preferences.columns);
  const preferenceSaveQueueRef = useRef<ReturnType<
    typeof createInventoryPreferenceSaveQueue
  > | null>(null);
  if (preferenceSaveQueueRef.current === null) {
    preferenceSaveQueueRef.current = createInventoryPreferenceSaveQueue(
      latestPreferenceRevisionRef,
      latestPreferenceColumnsRef,
      (request) => updateInventoryReviewPreferences(baseUrl, request),
      () => requestInventoryReviewPreferences(baseUrl),
      setPreferences,
      newInventoryIdempotencyKey,
    );
  }
  const canExport =
    identity?.state === "authenticated" &&
    identity.user.role.kind === "built-in" &&
    identity.user.role.key === "owner" &&
    identity.allowedPermissions.includes("inventory.valuation.view");
  const canRecordCount =
    identity?.state === "authenticated" &&
    identity.allowedPermissions.includes("inventory.counts.record");
  const canSearchCatalog =
    identity?.state === "authenticated" &&
    identity.allowedPermissions.includes("catalog.item.search");

  useEffect(() => {
    const query = normalizeIndicDigits(searchQuery.trim());
    setSearchIds(null);
    setSearchDegraded(false);
    if (query.length < 2 || !canSearchCatalog) return;
    const sequence = ++searchSequenceRef.current;
    const timer = window.setTimeout(() => {
      void collectCatalogSearchIds(baseUrl, query)
        .then((ids) => {
          if (searchSequenceRef.current === sequence) {
            setSearchIds(ids);
            setSearchDegraded(false);
          }
        })
        .catch(() => {
          if (searchSequenceRef.current === sequence) {
            setSearchIds(null);
            setSearchDegraded(true);
          }
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      searchSequenceRef.current++;
    };
  }, [baseUrl, canSearchCatalog, searchQuery]);

  async function addItemToBasket(item: InventoryItem): Promise<void> {
    if (!canManageReorder || addingProductId !== null) return;
    const attempt = inventoryCommandAttempt(
      reorderAttemptRef.current,
      item.productId,
    );
    reorderAttemptRef.current = attempt;
    setAddingProductId(item.productId);
    setBasketFeedback("");
    setError(null);
    setDenial(null);
    try {
      const result = await addReorderItem(baseUrl, {
        idempotencyKey: attempt.idempotencyKey,
        productId: item.productId,
      });
      // A completed add is a finished intent: the next press is a new
      // command (a re-add refreshes the proposal), not a retry of this one.
      reorderAttemptRef.current = null;
      if (result.outcome === "added") {
        basketRevisionRef.current++;
        setBasketCount((current) => (current === null ? 1 : current + 1));
      }
      const basketCopy = basketMessages[locale];
      const quantity = formatNumber(BigInt(result.item.quantity), locale);
      const unit = panelUnitLabel(
        result.item.product.inventoryUnitName,
        BigInt(result.item.quantity),
        locale,
      );
      const name = result.item.product.displayName;
      const feedback =
        result.outcome === "already-ordered"
          ? basketCopy.alreadyOrderedAnnouncement(name)
          : result.outcome === "updated"
            ? basketCopy.alreadyInBasketAnnouncement(name, quantity, unit)
            : basketCopy.addedAnnouncement(name, quantity, unit);
      setAnnouncement(feedback);
      setBasketFeedback(feedback);
    } catch (caught) {
      if (
        caught instanceof InventoryApiDenied ||
        caught instanceof IdentityApiDenied ||
        caught instanceof LicensingApiDenied
      ) {
        setDenial(caught.denial);
      } else {
        setError(basketMessages[locale].reviewUnavailable);
      }
    } finally {
      setAddingProductId(null);
    }
  }

  useEffect(() => {
    if (!canManageReorder) return;
    let active = true;
    const revision = basketRevisionRef.current;
    void readReorderBasket(baseUrl, { status: "basket" })
      .then(({ items: basketItems }) => {
        if (active && revision === basketRevisionRef.current)
          setBasketCount(basketItems.length);
      })
      .catch(() => {
        if (active && revision === basketRevisionRef.current)
          setBasketCount(null);
      });
    return () => {
      active = false;
    };
  }, [baseUrl, canManageReorder]);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    setDenial(null);
    try {
      const result = await requestInventoryItems(baseUrl);
      setItems(result.items);
      setValuation(result.fields.valuation);
    } catch (caught) {
      if (caught instanceof InventoryApiDenied) {
        setDenial(caught.denial);
      } else if (
        caught instanceof IdentityApiDenied ||
        caught instanceof LicensingApiDenied
      ) {
        setDenial(caught.denial);
      } else {
        setError(copy.reviewUnavailable);
      }
      return;
    }
    try {
      const savedPreferences = await requestInventoryReviewPreferences(baseUrl);
      latestPreferenceColumnsRef.current = savedPreferences.columns;
      latestPreferenceRevisionRef.current = savedPreferences.revision;
      setPreferences(savedPreferences);
      setPreferenceNotice(null);
    } catch {
      setPreferenceNotice(copy.preferencesUnavailable);
    }
    try {
      setSafetyStatus(await readBatchSafetyStatus(baseUrl));
    } catch {
      setSafetyStatus(null);
    }
  }, [baseUrl, copy.preferencesUnavailable, copy.reviewUnavailable]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = (): void => {
      void load();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);

  useEffect(() => {
    if (selectedProductId === null) {
      setPanelProduct(null);
      return;
    }
    let active = true;
    void requestProduct(baseUrl, selectedProductId)
      .then((product) => {
        if (active) setPanelProduct(product);
      })
      .catch(() => {
        if (active) setPanelProduct(null);
      });
    return () => {
      active = false;
    };
  }, [baseUrl, selectedProductId]);

  const availableFields = useMemo(
    () =>
      INVENTORY_COLUMN_FIELDS.filter(
        (field) => valuation === "granted" || !isValuationField(field),
      ),
    [valuation],
  );
  const visibleFields = useMemo(
    () =>
      availableFields.filter(
        (field) =>
          preferences.columns.find((column) => column.field === field)
            ?.visible ?? true,
      ),
    [availableFields, preferences.columns],
  );

  const sortedItems = useMemo(
    () =>
      [...(items ?? [])].sort((left, right) =>
        compareItems(left, right, sort.field, sort.direction),
      ),
    [items, sort],
  );
  const visibleItems = useMemo(() => {
    const query = normalizeIndicDigits(searchQuery.trim()).toLocaleLowerCase();
    if (query === "") return sortedItems;
    return sortedItems.filter(
      (item) =>
        normalizeIndicDigits(item.displayName)
          .toLocaleLowerCase()
          .includes(query) || searchIds?.has(item.productId),
    );
  }, [searchIds, searchQuery, sortedItems]);
  const selectedItem = items?.find(
    (item) => item.productId === selectedProductId,
  );
  const panelSelection: PurchaseItemSelection | null =
    panelProduct === null || panelProduct.id !== selectedProductId
      ? null
      : {
          inventory: {
            balance: selectedItem?.balance ?? "0",
            consumptionRatePer30Days:
              selectedItem?.consumptionRatePer30Days ?? "0",
            earliestExpiry: selectedItem?.batches.earliestExpiry ?? null,
            maximumLevel: selectedItem?.stockLevels.maximumLevel ?? null,
            minimumLevel: selectedItem?.stockLevels.minimumLevel ?? null,
          },
          product: panelProduct,
        };
  const metrics = useMemo(() => {
    const rows = items ?? [];
    const costs = rows.flatMap((item) =>
      item.averageUnitCostFils === null
        ? []
        : [BigInt(item.averageUnitCostFils)],
    );
    return {
      distinctItems: formatNumber(BigInt(rows.length), locale),
      itemsWithStock: formatNumber(
        BigInt(rows.filter((item) => BigInt(item.balance) > 0n).length),
        locale,
      ),
      totalValue:
        valuation === "granted"
          ? formatCurrencyFromFils(
              rows.reduce(
                (sum, item) => sum + BigInt(item.valueFils ?? "0"),
                0n,
              ),
              locale,
            )
          : "—",
      averageCost:
        valuation === "granted" && costs.length > 0
          ? formatCurrencyFromFils(
              costs.reduce((sum, cost) => sum + cost, 0n) /
                BigInt(costs.length),
              locale,
            )
          : "—",
    };
  }, [items, locale, valuation]);

  function changeSort(field: InventoryColumnField): void {
    const direction: SortDirection =
      sort.field === field && sort.direction === "ascending"
        ? "descending"
        : "ascending";
    setSort({ direction, field });
    setAnnouncement(
      copy.sortAnnouncement(inventoryColumnLabel(copy, field), direction),
    );
  }

  async function changeVisibility(
    field: InventoryColumnField,
    visible: boolean,
  ): Promise<void> {
    if (field === "item" || !availableFields.includes(field)) return;
    const activeTableColumn = document.activeElement?.closest<HTMLElement>(
      `th[data-column-field="${field}"], td[data-column-field="${field}"]`,
    );
    if (
      !visible &&
      activeTableColumn !== null &&
      activeTableColumn !== undefined
    ) {
      // The focused column leaves the DOM in this same commit, so the
      // settings toggle takes focus in that commit rather than a frame later.
      requestCommittedFocus(() => settingsToggleRef.current);
    }
    setPreferences((previous) => ({
      ...previous,
      columns: previous.columns.map((column) =>
        column.field === field ? { ...column, visible } : column,
      ),
    }));
    try {
      await preferenceSaveQueueRef.current!.enqueue(field, visible);
    } catch (caught) {
      setError(copy.reviewUnavailable);
      if (caught instanceof InventoryApiDenied) setDenial(caught.denial);
    }
  }

  const runStepUp = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await work();
      } catch (caught) {
        if (
          caught instanceof IdentityApiDenied ||
          caught instanceof LicensingApiDenied
        ) {
          setStepUpDenial(caught.denial);
        } else if (caught instanceof InventoryApiDenied) {
          setDenial(caught.denial);
        } else {
          setError(copy.reviewUnavailable);
        }
        return undefined;
      }
    },
    [copy.reviewUnavailable],
  );
  const stepUp = useStepUp(baseUrl, runStepUp);

  async function beginExport(format: "json" | "csv" = "json"): Promise<void> {
    setExportStatus("idle");
    await stepUp.begin(
      "inventory.sensitive.export",
      undefined,
      async (challengeId) => {
        try {
          const bundle = await exportInventorySensitiveData(baseUrl, {
            challengeId,
            idempotencyKey: newInventoryIdempotencyKey(),
          });
          const result = await window.breevDesktop.saveInventoryExport({
            bundle,
            locale,
            ...(format === "csv" ? { format } : {}),
          });
          setExportStatus(result.status);
        } catch (caught) {
          setExportStatus("failed");
          if (caught instanceof InventoryApiDenied) setDenial(caught.denial);
          else setError(copy.reviewUnavailable);
        }
      },
    );
  }

  if (denial !== null && items === null) {
    return (
      <InventoryFailure
        message={copy.permissionDenied + " " + denial.requestId}
        onRetry={async () => {
          await checkNow();
          await load();
        }}
        retry={copy.retry}
      />
    );
  }
  if (error !== null && items === null) {
    return (
      <InventoryFailure
        message={error}
        onRetry={async () => {
          await checkNow();
          await load();
        }}
        retry={copy.retry}
      />
    );
  }
  if (items === null) {
    return (
      <section className="inventory-workspace">
        <p role="status">{copy.loading}</p>
      </section>
    );
  }

  return (
    <section
      className="inventory-workspace inventory-review"
      aria-labelledby="inventory-title"
    >
      <h2 className="visually-hidden" id="inventory-title">
        {copy.title}
      </h2>
      <div className="inventory-metrics">
        <InventoryMetric
          label={copy.metrics.totalValue}
          locale={locale}
          money
          tone="emerald"
          value={metrics.totalValue}
        />
        <InventoryMetric
          label={copy.metrics.averageCost}
          locale={locale}
          money
          tone="accent"
          value={metrics.averageCost}
        />
        <InventoryMetric
          label={copy.metrics.distinctItems}
          tone="emerald"
          value={metrics.distinctItems}
        />
        <InventoryMetric
          label={copy.metrics.itemsWithStock}
          tone="accent"
          value={metrics.itemsWithStock}
        />
      </div>
      <div className="inventory-toolbar">
        <label className="inventory-search">
          <span className="visually-hidden">{copy.searchLabel}</span>
          <input
            autoComplete="off"
            placeholder={copy.searchLabel}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchDegraded ? (
            <p className="field-hint" role="status">
              {copy.searchDegraded}
            </p>
          ) : null}
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16.5 20 20.5" />
          </svg>
        </label>
        <div className="inventory-toolbar-actions">
          {canRecordCount ? (
            <a
              className="inventory-chip inventory-chip-primary"
              href="#/inventory/count"
            >
              {copy.count.start}
            </a>
          ) : null}
          {canExport ? (
            <>
              <button
                aria-label={copy.export}
                className="inventory-chip"
                type="button"
                onClick={() => void beginExport()}
              >
                {locale === "ar" ? "تصدير" : "Export"}
              </button>
              <button
                aria-label={copy.exportCsv}
                className="inventory-chip"
                type="button"
                onClick={() => void beginExport("csv")}
              >
                {locale === "ar" ? "تصدير CSV" : "Export CSV"}
              </button>
            </>
          ) : null}
          {canManageReorder ? (
            <a className="inventory-chip" href="#/basket">
              {copy.openBasket}
              {basketCount === null ? null : (
                <span aria-hidden="true" className="inventory-basket-count">
                  {basketCount}
                </span>
              )}
            </a>
          ) : null}
          <details className="inventory-settings">
            <summary ref={settingsToggleRef}>{copy.settings}</summary>
            <div className="inventory-settings-panel">
              <p>{copy.settingsNote}</p>
              {INVENTORY_COLUMN_FIELDS.map((field) => {
                const disabled =
                  field === "item" || !availableFields.includes(field);
                const checked = visibleFields.includes(field);
                return (
                  <label
                    className="inventory-column-option"
                    data-column-field={field}
                    key={field}
                  >
                    <input
                      checked={checked}
                      disabled={disabled}
                      type="checkbox"
                      onChange={(event) =>
                        void changeVisibility(field, event.target.checked)
                      }
                    />
                    <span>{inventoryColumnLabel(copy, field)}</span>
                  </label>
                );
              })}
              {valuation === "denied" ? <p>{copy.valuationDenied}</p> : null}
            </div>
          </details>
        </div>
      </div>
      <p className="inventory-safety-summary">
        {safetyStatus === null
          ? copy.safety.unavailable
          : copy.safety.dailyStatus(
              safetyStatus.state,
              safetyStatus.lastCompletedBusinessDate,
            )}{" "}
        <a href="#/inventory/safety-review">{copy.safety.review}</a>
      </p>
      <p className="visually-hidden" id="inventory-read-only">
        {copy.readOnly}
      </p>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      {basketFeedback === "" ? null : (
        <p className="inventory-basket-feedback" role="status">
          {basketFeedback}
        </p>
      )}
      {selectedItem === undefined ? null : (
        <p className="inventory-selection visually-hidden" role="status">
          <strong>{selectedItem.displayName}</strong>
          <span>
            {copy.columns.balance}:{" "}
            {formatNumber(BigInt(selectedItem.balance), locale)}
          </span>
          <span>
            {selectedItem.stateColour.manual ??
              copy.stateColours[selectedItem.stateColour.automatic]}
          </span>
          <a href={`#/inventory/items/${selectedItem.productId}/movements`}>
            {copy.movement.title}
          </a>
        </p>
      )}
      <ul aria-label={copy.statusColumn} className="inventory-tint-legend">
        {(
          [
            ["stable", statusMeaning(copy.stateColours.green)],
            ["reorder", statusMeaning(copy.stateColours.orange)],
            ["expiring", statusMeaning(copy.stateColours.yellow)],
            ["over-maximum", statusMeaning(copy.stateColours.purple)],
            ["critical", statusMeaning(copy.stateColours.red)],
          ] as const
        ).map(([status, label]) => (
          <li data-status={status} key={status}>
            <span aria-hidden="true" className="inventory-tint-swatch" />
            <span>{label}</span>
          </li>
        ))}
      </ul>
      {denial === null ? null : (
        <div className="denial-alert" role="alert">
          <p>
            {copy.permissionDenied} {denial.requestId}
          </p>
        </div>
      )}
      {preferenceNotice === null ? null : (
        <p className="field-hint" role="status">
          {preferenceNotice}
        </p>
      )}
      {error === null ? null : (
        <div className="denial-alert" role="alert">
          <p>{error}</p>
        </div>
      )}
      {exportStatus === "saved" ? (
        <p className="support-action-status" role="status">
          {copy.exportSaved}
        </p>
      ) : null}
      {exportStatus === "cancelled" ? (
        <p className="support-action-status" role="status">
          {copy.exportCancelled}
        </p>
      ) : null}
      {exportStatus === "failed" ? (
        <p className="support-action-status" role="alert">
          {copy.exportFailed}
        </p>
      ) : null}
      {exportStatus === "export-too-large" ? (
        <p className="support-action-status" role="alert">
          {copy.exportTooLarge}
        </p>
      ) : null}
      {visibleItems.length === 0 ? (
        <p role="status">{copy.empty}</p>
      ) : (
        <InventoryReviewTable
          addingProductId={addingProductId}
          canManageReorder={canManageReorder}
          copy={copy}
          items={visibleItems}
          locale={locale}
          selectedProductId={selectedProductId}
          sort={sort}
          visibleFields={visibleFields}
          onAdd={(item) => void addItemToBasket(item)}
          onSelect={(item) => {
            setSelectedProductId(item.productId);
            setAnnouncement(item.displayName);
          }}
          onSort={changeSort}
        />
      )}
      <div className="inventory-bottom-bar">
        {canRecordCount ? (
          <a
            aria-hidden="true"
            className="inventory-tool inventory-tool-strong"
            href="#/inventory/count"
            tabIndex={-1}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M7 7h10M7 12h10M7 17h6" />
            </svg>
            {copy.count.start}
          </a>
        ) : null}
      </div>
      <PurchaseItemPanel
        defaultExpanded
        emptyMessage={copy.panelEmpty}
        hidden={false}
        selection={panelSelection}
      />
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

function InventoryMetric({
  label,
  locale,
  money = false,
  tone,
  value,
}: {
  readonly label: string;
  readonly locale?: "ar" | "en";
  readonly money?: boolean;
  readonly tone?: "emerald" | "accent";
  readonly value: string;
}): React.JSX.Element {
  return (
    <div className="inventory-metric" data-tone={tone}>
      <span>{label}</span>
      <strong>
        {money && locale !== undefined ? (
          <MoneyAmount locale={locale} value={value} />
        ) : (
          <bdi>{value}</bdi>
        )}
      </strong>
    </div>
  );
}

function InventoryReviewTable({
  addingProductId,
  canManageReorder,
  copy,
  items,
  locale,
  onAdd,
  onSelect,
  onSort,
  selectedProductId,
  sort,
  visibleFields,
}: {
  readonly addingProductId: string | null;
  readonly canManageReorder: boolean;
  readonly copy: InventoryCopy;
  readonly items: readonly InventoryItem[];
  readonly locale: "ar" | "en";
  readonly onAdd: (item: InventoryItem) => void;
  readonly onSelect: (item: InventoryItem) => void;
  readonly onSort: (field: InventoryColumnField) => void;
  readonly selectedProductId: string | null;
  readonly sort: SortState;
  readonly visibleFields: readonly InventoryColumnField[];
}): React.JSX.Element {
  return (
    <div className="inventory-table-scroll">
      <table
        aria-describedby="inventory-read-only"
        className="inventory-review-table"
      >
        <caption className="visually-hidden">{copy.title}</caption>
        <thead>
          <tr>
            {visibleFields.map((field) => (
              <th
                aria-sort={sort.field === field ? sort.direction : undefined}
                data-column-field={field}
                key={field}
                scope="col"
              >
                <button
                  className="inventory-sort-button"
                  type="button"
                  onClick={() => onSort(field)}
                >
                  {inventoryColumnLabel(copy, field)}
                  <span aria-hidden="true" className="inventory-sort-icon">
                    {sort.field !== field
                      ? "↕"
                      : sort.direction === "ascending"
                        ? "↑"
                        : "↓"}
                  </span>
                </button>
              </th>
            ))}
            <th data-column-field="actions" scope="col">
              {copy.actionsColumn}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            return (
              <tr
                key={item.productId}
                data-selected={selectedProductId === item.productId}
                data-status={inventoryRowStatus(item)}
                onClick={(event) => {
                  if (
                    event.target instanceof Element &&
                    event.target.closest("button, a, input")
                  )
                    return;
                  onSelect(item);
                }}
                onKeyDown={(event) => {
                  if (
                    event.target !== event.currentTarget ||
                    (event.key !== "Enter" && event.key !== " ")
                  )
                    return;
                  event.preventDefault();
                  onSelect(item);
                }}
                tabIndex={0}
              >
                {visibleFields.map((field) => (
                  <td data-column-field={field} key={field}>
                    <InventoryCell
                      copy={copy}
                      field={field}
                      item={item}
                      locale={locale}
                    />
                  </td>
                ))}
                <td
                  className="inventory-actions-cell"
                  data-column-field="actions"
                >
                  {canManageReorder ? (
                    <button
                      aria-label={copy.addToBasketAriaLabel(item.displayName)}
                      aria-disabled={addingProductId === item.productId}
                      className="quiet-button inventory-cart-add"
                      data-review-focus={`inventory-basket-add-${item.productId}`}
                      title={copy.addToBasket}
                      type="button"
                      onClick={() => onAdd(item)}
                    >
                      <BasketIcon />
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InventoryCell({
  copy,
  field,
  item,
  locale,
}: {
  readonly copy: InventoryCopy;
  readonly field: InventoryColumnField;
  readonly item: InventoryItem;
  readonly locale: "ar" | "en";
}): React.JSX.Element {
  switch (field) {
    case "item":
      return (
        <div className="inventory-item-cell">
          <button
            className="table-link"
            data-review-focus={`inventory-item-${item.productId}`}
            type="button"
            onClick={() => {
              window.location.hash = `#/inventory/items/${item.productId}/movements`;
            }}
          >
            {item.displayName}
          </button>
        </div>
      );
    case "balance":
      return <bdi>{formatNumber(BigInt(item.balance), locale)}</bdi>;
    case "value":
      return item.valueFils === null ? (
        <span>—</span>
      ) : (
        <MoneyAmount
          locale={locale}
          value={formatCurrencyFromFils(BigInt(item.valueFils), locale)}
        />
      );
    case "averageCost":
      return item.averageUnitCostFils === null ? (
        <span>—</span>
      ) : (
        <MoneyAmount
          locale={locale}
          value={formatCurrencyFromFils(
            BigInt(item.averageUnitCostFils),
            locale,
          )}
        />
      );
    case "batches":
      return <bdi>{formatNumber(BigInt(item.batches.count), locale)}</bdi>;
    case "expiry":
      return <bdi>{item.batches.earliestExpiry ?? "—"}</bdi>;
    case "levels":
      return <bdi>{levelText(item, locale)}</bdi>;
    case "reorderPoint":
      return (
        <bdi>
          {item.stockLevels.reorderPoint === null
            ? "—"
            : formatNumber(BigInt(item.stockLevels.reorderPoint), locale)}
        </bdi>
      );
    case "consumptionRate":
      return (
        <bdi>{formatNumber(BigInt(item.consumptionRatePer30Days), locale)}</bdi>
      );
    case "risk":
      return <InventoryStatusBadges copy={copy} item={item} />;
  }
}

const STATUS_RISK_PRIORITY = [
  "recalled",
  "quarantined",
  "expired",
  "out-of-stock",
  "expiring-soon",
  "below-minimum",
  "at-or-below-reorder-point",
  "above-maximum",
  "cold-storage",
  "missing-barcode",
] as const satisfies readonly InventoryRiskIndicator[];

export function inventoryRiskSortRank(item: InventoryItem): bigint {
  const index = STATUS_RISK_PRIORITY.findIndex((indicator) =>
    item.riskIndicators.includes(indicator),
  );
  return index === -1 ? BigInt(STATUS_RISK_PRIORITY.length) : BigInt(index);
}

function InventoryStatusBadges({
  copy,
  item,
}: {
  readonly copy: InventoryCopy;
  readonly item: InventoryItem;
}): React.JSX.Element {
  const colourLabel = copy.stateColours[item.stateColour.automatic];
  const ordered = STATUS_RISK_PRIORITY.filter((indicator) =>
    item.riskIndicators.includes(indicator),
  );
  const primary = ordered[0];
  if (primary === undefined) {
    return (
      <span className="inventory-status-badges">
        <StateIndicator
          assistiveLabel={colourLabel}
          colour={item.stateColour.automatic}
          customColour={item.stateColour.manual ?? undefined}
          kind="state"
          label={statusMeaning(colourLabel)}
        />
      </span>
    );
  }
  return (
    <span className="inventory-status-badges">
      <StateIndicator
        assistiveLabel={colourLabel}
        indicator={primary}
        kind="risk"
        label={copy.riskIndicators[primary]}
      />
      {ordered.slice(1).map((indicator) => (
        <span data-indicator={indicator} key={indicator}>
          {copy.riskIndicators[indicator]}
        </span>
      ))}
    </span>
  );
}

function BasketIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="m15 11-1 9" />
      <path d="m19 11-4-7" />
      <path d="M2 11h20" />
      <path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4" />
      <path d="M4.5 15.5h15" />
      <path d="m5 11 4-7" />
      <path d="m9 11 1 9" />
    </svg>
  );
}

function inventoryColumnLabel(
  copy: InventoryCopy,
  field: InventoryColumnField,
): string {
  return field === "risk" ? copy.statusColumn : copy.columns[field];
}

function statusMeaning(label: string): string {
  const separator = " — ";
  const index = label.indexOf(separator);
  return index === -1 ? label : label.slice(index + separator.length);
}

function inventoryRowStatus(item: InventoryItem): string {
  if (
    item.riskIndicators.includes("expired") ||
    item.riskIndicators.includes("out-of-stock") ||
    item.stateColour.automatic === "red"
  )
    return "critical";
  if (item.riskIndicators.includes("expiring-soon")) return "expiring";
  if (
    item.riskIndicators.includes("below-minimum") ||
    item.riskIndicators.includes("at-or-below-reorder-point")
  )
    return "reorder";
  if (
    item.riskIndicators.includes("above-maximum") ||
    item.stateColour.automatic === "purple"
  )
    return "over-maximum";
  return "stable";
}

function levelText(item: InventoryItem, locale: "ar" | "en"): string {
  const minimum =
    item.stockLevels.minimumLevel === null
      ? "—"
      : formatNumber(BigInt(item.stockLevels.minimumLevel), locale);
  const maximum =
    item.stockLevels.maximumLevel === null
      ? "—"
      : formatNumber(BigInt(item.stockLevels.maximumLevel), locale);
  return minimum + " / " + maximum;
}

function compareItems(
  left: InventoryItem,
  right: InventoryItem,
  field: InventoryColumnField,
  direction: SortDirection,
): number {
  const value = (item: InventoryItem): bigint | string | null => {
    switch (field) {
      case "item":
        return item.displayName;
      case "balance":
        return BigInt(item.balance);
      case "value":
        return item.valueFils === null ? null : BigInt(item.valueFils);
      case "averageCost":
        return item.averageUnitCostFils === null
          ? null
          : BigInt(item.averageUnitCostFils);
      case "batches":
        return BigInt(item.batches.count);
      case "expiry":
        return item.batches.earliestExpiry;
      case "levels":
        return item.stockLevels.minimumLevel === null
          ? null
          : BigInt(item.stockLevels.minimumLevel);
      case "reorderPoint":
        return item.stockLevels.reorderPoint === null
          ? null
          : BigInt(item.stockLevels.reorderPoint);
      case "consumptionRate":
        return BigInt(item.consumptionRatePer30Days);
      case "risk":
        return inventoryRiskSortRank(item);
    }
  };
  return compareSortable(value(left), value(right), direction);
}

export function compareSortable(
  left: bigint | string | null,
  right: bigint | string | null,
  direction: SortDirection,
): number {
  const leftMissing = isMissingSortValue(left);
  const rightMissing = isMissingSortValue(right);
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing ? 1 : -1;
  }
  const compared =
    typeof left === "bigint" && typeof right === "bigint"
      ? left < right
        ? -1
        : left > right
          ? 1
          : 0
      : String(left).localeCompare(String(right));
  return direction === "ascending" ? compared : -compared;
}

function isMissingSortValue(value: bigint | string | null): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}

function isValuationField(field: InventoryColumnField): boolean {
  return field === "value" || field === "averageCost";
}

function InventoryFailure({
  message,
  onRetry,
  retry,
}: {
  readonly message: string;
  readonly onRetry: () => Promise<void>;
  readonly retry: string;
}): React.JSX.Element {
  return (
    <section className="inventory-workspace">
      <div className="denial-alert" role="alert">
        <p>{message}</p>
        <button
          className="quiet-button"
          type="button"
          onClick={() => void onRetry()}
        >
          {retry}
        </button>
      </div>
    </section>
  );
}

export function InventoryMovements({
  baseUrl,
  checkNow,
  documentId,
  documentType,
  productId,
}: {
  readonly baseUrl: string;
  readonly checkNow: () => Promise<void>;
  readonly documentId: string | undefined;
  readonly documentType: "purchase" | "count-session" | undefined;
  readonly productId: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = inventoryMessages[locale];
  const [response, setResponse] = useState<Awaited<
    ReturnType<typeof requestInventoryMovements>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestCommittedFocus = useCommittedFocus();
  // The shell's hash state only follows `hashchange`, so a dialog dismissed
  // with `history.replaceState` would otherwise reopen on the next commit.
  const [dismissedDocumentId, setDismissedDocumentId] = useState<string | null>(
    null,
  );
  const reviewOpen =
    documentId !== undefined && documentId !== dismissedDocumentId;

  const load = useCallback(async () => {
    try {
      setResponse(await requestInventoryMovements(baseUrl, productId));
    } catch {
      setError(copy.reviewUnavailable);
    }
  }, [baseUrl, copy.reviewUnavailable, productId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error !== null) {
    return (
      <InventoryFailure
        message={error}
        onRetry={async () => {
          await checkNow();
          await load();
        }}
        retry={copy.retry}
      />
    );
  }
  if (response === null)
    return (
      <section className="inventory-workspace">
        <p role="status">{copy.loading}</p>
      </section>
    );

  return (
    <section
      className="inventory-workspace inventory-detail-page"
      aria-labelledby="inventory-movement-title"
    >
      <header className="inventory-detail-header">
        <div className="inventory-detail-heading">
          <a
            className="inventory-chip inventory-chip-primary"
            href="#/inventory"
          >
            {copy.backToInventory}
          </a>
          <h2 id="inventory-movement-title">
            {copy.movement.title} — <bdi>{response.productDisplayName}</bdi>
          </h2>
        </div>
      </header>
      <BatchSafetyPanel
        baseUrl={baseUrl}
        checkNow={checkNow}
        productId={productId}
      />
      {response.movements.length === 0 ? (
        <div className="inventory-history-card inventory-history-empty">
          <p role="status">{copy.movement.empty}</p>
        </div>
      ) : (
        <div className="inventory-table-scroll inventory-history-card">
          <table className="inventory-history-table">
            <caption className="visually-hidden">{copy.movement.title}</caption>
            <thead>
              <tr>
                <th scope="col">{copy.movement.reference}</th>
                <th scope="col">{copy.movement.kind}</th>
                <th scope="col">{copy.movement.date}</th>
                <th scope="col">{copy.movement.time}</th>
                <th scope="col">{copy.movement.user}</th>
                <th scope="col">{copy.movement.quantity}</th>
                <th scope="col">{copy.movement.value}</th>
              </tr>
            </thead>
            <tbody>
              {response.movements.map((movement) => {
                const referenceLabel = movement.reference.label;
                const reference = movement.reference.openable ? (
                  <button
                    className="table-link"
                    data-review-focus={`movement-${movement.id}`}
                    type="button"
                    onClick={(event) => {
                      openerRef.current = event.currentTarget;
                      const nextHash =
                        movement.reference.documentType === "count-session"
                          ? `#/inventory/items/${productId}/movements/count-sessions/${movement.reference.documentId}`
                          : `#/inventory/items/${productId}/movements/${movement.reference.documentId}`;
                      // Closing the review uses replaceState, so the shell
                      // still holds this document id and a repeat click does
                      // not change that prop. Clear the dismiss flag or the
                      // same reference stays closed until another one opens.
                      setDismissedDocumentId(null);
                      if (window.location.hash !== nextHash) {
                        window.location.hash = nextHash;
                      }
                    }}
                  >
                    {referenceLabel}
                  </button>
                ) : (
                  <span>{referenceLabel}</span>
                );
                return (
                  <tr key={movement.id}>
                    <td data-review-focus={`movement-${movement.id}`}>
                      {reference}
                    </td>
                    <td>{movementKindLabel(movement.kind, copy)}</td>
                    <td>
                      <bdi>
                        {formatDate(new Date(movement.occurredAt), locale)}
                      </bdi>
                    </td>
                    <td>
                      <bdi>
                        {formatTime(new Date(movement.occurredAt), locale)}
                      </bdi>
                    </td>
                    <td>{movement.user.displayName}</td>
                    <td>
                      <bdi>
                        {formatNumber(BigInt(movement.quantity), locale)}
                      </bdi>
                    </td>
                    <td>
                      {movement.valueFils === null ? (
                        "—"
                      ) : (
                        <MoneyAmount
                          locale={locale}
                          value={formatCurrencyFromFils(
                            BigInt(movement.valueFils),
                            locale,
                          )}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <PostedPurchaseReview
        {...(documentType !== "purchase" || documentId === undefined
          ? {}
          : { address: { id: documentId } })}
        baseUrl={baseUrl}
        onClose={() => {
          setDismissedDocumentId(documentId ?? null);
          window.history.replaceState(
            null,
            "",
            "#/inventory/items/" + productId + "/movements",
          );
          requestCommittedFocus(() => openerRef.current);
        }}
        open={documentType === "purchase" && reviewOpen}
        returnHash={`#/inventory/items/${productId}/movements`}
      />
      <CountSessionReview
        {...(documentType !== "count-session" || documentId === undefined
          ? {}
          : { address: { id: documentId } })}
        baseUrl={baseUrl}
        onClose={() => {
          setDismissedDocumentId(documentId ?? null);
          window.history.replaceState(
            null,
            "",
            `#/inventory/items/${productId}/movements`,
          );
          requestCommittedFocus(() => openerRef.current);
        }}
        open={documentType === "count-session" && reviewOpen}
        returnHash={`#/inventory/items/${productId}/movements`}
      />
    </section>
  );
}

function movementKindLabel(
  kind: InventoryMovement["kind"],
  copy: InventoryCopy,
): string {
  switch (kind) {
    case "purchase-adjustment":
      return copy.movement.adjustment;
    case "purchase-receipt":
      return copy.movement.receipt;
    case "purchase-return":
      return copy.movement.return;
    case "count-variance":
      return copy.movement.countVariance;
    default:
      return assertNever(kind);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected inventory movement kind: ${String(value)}`);
}

export function inventoryRoute(hash: string):
  | { readonly kind: "inventory" }
  | { readonly kind: "count" }
  | { readonly kind: "count-session"; readonly sessionId: string }
  | { readonly kind: "safety-review"; readonly month?: string }
  | {
      readonly kind: "movements";
      readonly productId: string;
      readonly documentId?: string;
      readonly documentType?: "purchase" | "count-session";
    } {
  const parts = hash.replace(/^#\//u, "").split("/");
  if (parts[0] === "inventory" && parts[1] === "count") {
    if (parts.length === 2) return { kind: "count" };
    if (parts.length === 3 && parts[2] !== undefined) {
      return { kind: "count-session", sessionId: parts[2] };
    }
    return { kind: "inventory" };
  }
  if (parts[0] === "inventory" && parts[1] === "safety-review") {
    if (
      parts.length > 3 ||
      (parts[2] !== undefined && !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(parts[2]))
    ) {
      return { kind: "inventory" };
    }
    return {
      kind: "safety-review",
      ...(parts[2] === undefined ? {} : { month: parts[2] }),
    };
  }
  if (
    parts[0] !== "inventory" ||
    parts[1] !== "items" ||
    parts[3] !== "movements"
  ) {
    return { kind: "inventory" };
  }
  const productId = parts[2];
  if (productId === undefined) return { kind: "inventory" };
  if (parts.length === 4) {
    return { kind: "movements", productId };
  }
  if (parts.length === 5 && parts[4] !== undefined) {
    return {
      documentId: parts[4],
      documentType: "purchase",
      kind: "movements",
      productId,
    };
  }
  if (
    parts.length === 6 &&
    parts[4] === "count-sessions" &&
    parts[5] !== undefined
  ) {
    return {
      documentId: parts[5],
      documentType: "count-session",
      kind: "movements",
      productId,
    };
  }
  return { kind: "inventory" };
}
