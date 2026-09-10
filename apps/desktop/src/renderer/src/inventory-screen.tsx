import {
  INVENTORY_COLUMN_FIELDS,
  type IdentityDenial,
  type InventoryColumnField,
  type InventoryDenial,
  type InventoryItem,
  type InventoryMovement,
  type LicensingDenial,
} from "@breev/contracts/local-rest";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  InventoryApiDenied,
  exportInventorySensitiveData,
  newInventoryIdempotencyKey,
  requestInventoryItems,
  requestInventoryMovements,
  requestInventoryReviewPreferences,
  updateInventoryReviewPreferences,
} from "./inventory-api";
import { inventoryMessages, type InventoryCopy } from "./inventory-messages";
import { createInventoryPreferenceSaveQueue } from "./inventory-preferences-save";
import { useIdentityState } from "./identity-state-provider";
import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
import { identityMessages } from "./identity-messages";
import { licensingMessages } from "./licensing-messages";
import { usePreferences } from "./preferences-provider";
import {
  formatCurrencyFromFils,
  formatDate,
  formatNumber,
  formatTime,
} from "./preferences";
import { PostedPurchaseReview } from "./posted-purchase-review";
import { StateIndicator } from "./state-indicator";
import { StepUpDialog, useStepUp } from "./step-up";

type SortDirection = "ascending" | "descending";
type SortState = {
  readonly field: InventoryColumnField;
  readonly direction: SortDirection;
};
type ReviewDenial = IdentityDenial | InventoryDenial | LicensingDenial;

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
  if (route.kind === "movements") {
    return (
      <InventoryMovements
        baseUrl={baseUrl}
        checkNow={checkNow}
        productId={route.productId}
        purchaseId={route.purchaseId}
      />
    );
  }
  return <InventoryScreen baseUrl={baseUrl} checkNow={checkNow} />;
}

function InventoryScreen({
  baseUrl,
  checkNow,
}: {
  readonly baseUrl: string;
  readonly checkNow: () => Promise<void>;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = inventoryMessages[locale];
  const { state: identity } = useIdentityState();
  const [items, setItems] = useState<InventoryItem[] | null>(null);
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
  const [sort, setSort] = useState<SortState>({
    direction: "ascending",
    field: "item",
  });
  const [exportStatus, setExportStatus] = useState<
    "cancelled" | "failed" | "idle" | "saved"
  >("idle");
  const [pendingSettingsFocus, setPendingSettingsFocus] = useState(false);
  const settingsToggleRef = useRef<HTMLElement>(null);
  const latestPreferenceRevisionRef = useRef(preferences.revision);
  const preferenceSaveQueueRef = useRef<ReturnType<
    typeof createInventoryPreferenceSaveQueue
  > | null>(null);
  if (preferenceSaveQueueRef.current === null) {
    preferenceSaveQueueRef.current = createInventoryPreferenceSaveQueue(
      latestPreferenceRevisionRef,
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

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    setDenial(null);
    try {
      const [result, savedPreferences] = await Promise.all([
        requestInventoryItems(baseUrl),
        requestInventoryReviewPreferences(baseUrl),
      ]);
      setItems(result.items);
      setValuation(result.fields.valuation);
      latestPreferenceRevisionRef.current = savedPreferences.revision;
      setPreferences(savedPreferences);
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
    }
  }, [baseUrl, copy.reviewUnavailable]);

  useEffect(() => {
    void load();
  }, [load]);

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

  useEffect(() => {
    if (!pendingSettingsFocus) return;
    settingsToggleRef.current?.focus();
    setPendingSettingsFocus(false);
  }, [pendingSettingsFocus, visibleFields]);

  const sortedItems = useMemo(
    () =>
      [...(items ?? [])].sort((left, right) => {
        const compared = compareItems(left, right, sort.field);
        return sort.direction === "ascending" ? compared : -compared;
      }),
    [items, sort],
  );

  function changeSort(field: InventoryColumnField): void {
    const direction: SortDirection =
      sort.field === field && sort.direction === "ascending"
        ? "descending"
        : "ascending";
    setSort({ direction, field });
    setAnnouncement(copy.sortAnnouncement(copy.columns[field], direction));
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
      setPendingSettingsFocus(true);
    }
    const columns = preferences.columns.map((column) =>
      column.field === field ? { ...column, visible } : column,
    );
    setPreferences((previous) => ({ ...previous, columns }));
    try {
      const saved = await preferenceSaveQueueRef.current!.enqueue(columns);
      setPreferences(saved);
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

  async function beginExport(): Promise<void> {
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
    <section className="inventory-workspace" aria-labelledby="inventory-title">
      <header className="inventory-heading">
        <div>
          <h2 id="inventory-title">{copy.title}</h2>
          <p>{copy.readOnly}</p>
        </div>
        <div className="inventory-actions">
          {canExport ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => void beginExport()}
            >
              {copy.export}
            </button>
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
                    <span>{copy.columns[field]}</span>
                  </label>
                );
              })}
              {valuation === "denied" ? <p>{copy.valuationDenied}</p> : null}
            </div>
          </details>
        </div>
      </header>
      <p className="visually-hidden" id="inventory-read-only">
        {copy.readOnly}
      </p>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      {denial === null ? null : (
        <div className="denial-alert" role="alert">
          <p>
            {copy.permissionDenied} {denial.requestId}
          </p>
        </div>
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
      {items.length === 0 ? (
        <p role="status">{copy.empty}</p>
      ) : (
        <div className="inventory-table-scroll">
          <table aria-describedby="inventory-read-only">
            <caption className="visually-hidden">{copy.title}</caption>
            <thead>
              <tr>
                {visibleFields.map((field) => (
                  <th
                    aria-sort={sort.field === field ? sort.direction : "none"}
                    data-column-field={field}
                    key={field}
                    scope="col"
                  >
                    <button type="button" onClick={() => changeSort(field)}>
                      {copy.columns[field]}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => (
                <tr key={item.productId}>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      );
    case "balance":
      return <bdi>{formatNumber(BigInt(item.balance), locale)}</bdi>;
    case "value":
      return item.valueFils === null ? (
        <span>—</span>
      ) : (
        <bdi>{formatCurrencyFromFils(BigInt(item.valueFils), locale)}</bdi>
      );
    case "averageCost":
      return item.averageUnitCostFils === null ? (
        <span>—</span>
      ) : (
        <bdi>
          {formatCurrencyFromFils(BigInt(item.averageUnitCostFils), locale)}
        </bdi>
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
      return (
        <div className="inventory-indicators">
          <StateIndicator
            assistiveLabel={copy.stateColours[item.stateColour.effective]}
            colour={item.stateColour.effective}
            kind="state"
            label={copy.stateColours[item.stateColour.effective]}
          />
          <small>
            {copy.automatic}: {copy.stateColours[item.stateColour.automatic]}
          </small>
          <small>
            {copy.manual}:{" "}
            {item.stateColour.manual === null
              ? copy.manualNone
              : copy.stateColours[item.stateColour.manual]}
          </small>
          {item.riskIndicators.map((indicator) => (
            <StateIndicator
              indicator={indicator}
              key={indicator}
              kind="risk"
              label={copy.riskIndicators[indicator]}
            />
          ))}
        </div>
      );
  }
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
        return item.riskIndicators.join(",");
    }
  };
  return compareSortable(value(left), value(right));
}

function compareSortable(
  left: bigint | string | null,
  right: bigint | string | null,
): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (typeof left === "bigint" && typeof right === "bigint")
    return left < right ? -1 : 1;
  return String(left).localeCompare(String(right));
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
  productId,
  purchaseId,
}: {
  readonly baseUrl: string;
  readonly checkNow: () => Promise<void>;
  readonly productId: string;
  readonly purchaseId: string | undefined;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = inventoryMessages[locale];
  const [response, setResponse] = useState<Awaited<
    ReturnType<typeof requestInventoryMovements>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

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
      className="inventory-workspace"
      aria-labelledby="inventory-movement-title"
    >
      <p>
        <a href="#/inventory">{copy.backToInventory}</a>
      </p>
      <h2 id="inventory-movement-title">
        {copy.movement.title} · <bdi>{response.productDisplayName}</bdi>
      </h2>
      {response.movements.length === 0 ? (
        <p role="status">{copy.movement.empty}</p>
      ) : (
        <div className="inventory-table-scroll">
          <table>
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
                      window.location.hash = `#/inventory/items/${productId}/movements/${movement.reference.documentId}`;
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
                      <bdi>
                        {movement.valueFils === null
                          ? "—"
                          : formatCurrencyFromFils(
                              BigInt(movement.valueFils),
                              locale,
                            )}
                      </bdi>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <PostedPurchaseReview
        {...(purchaseId === undefined ? {} : { address: { id: purchaseId } })}
        baseUrl={baseUrl}
        onClose={() => {
          window.history.replaceState(
            null,
            "",
            "#/inventory/items/" + productId + "/movements",
          );
          queueMicrotask(() => openerRef.current?.focus());
        }}
        open={purchaseId !== undefined}
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
    default:
      return assertNever(kind);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected inventory movement kind: ${String(value)}`);
}

function inventoryRoute(hash: string):
  | { readonly kind: "inventory" }
  | {
      readonly kind: "movements";
      readonly productId: string;
      readonly purchaseId?: string;
    } {
  const parts = hash.replace(/^#\//u, "").split("/");
  if (
    parts[0] !== "inventory" ||
    parts[1] !== "items" ||
    parts[3] !== "movements"
  ) {
    return { kind: "inventory" };
  }
  const productId = parts[2];
  if (productId === undefined || parts.length > 5) return { kind: "inventory" };
  return {
    kind: "movements",
    productId,
    ...(parts[4] === undefined ? {} : { purchaseId: parts[4] }),
  };
}
