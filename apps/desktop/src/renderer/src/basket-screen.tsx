import type {
  IdentityDenial,
  InventoryDenial,
  LicensingDenial,
  ReorderItem,
} from "@breev/contracts/local-rest";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCommittedFocus } from "./committed-focus";
import {
  BASKET_DENIAL_CODES,
  basketMessages,
  type BasketDenialCode,
  type BasketCopy,
  type BasketProjectionSummary,
  type BasketQuantityPart,
} from "./basket-messages";
import { describeInventoryUnits } from "./basket-quantity";
import { normalizedCount } from "./count-entry";
import {
  confirmReorderItem,
  InventoryApiDenied,
  inventoryCommandAttempt,
  readReorderBasket,
  removeReorderItem,
  returnReorderItem,
  updateReorderItemQuantity,
} from "./inventory-api";
import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
import { useIdentityState } from "./identity-state-provider";
import { inventoryMessages, type InventoryCopy } from "./inventory-messages";
import { usePreferences } from "./preferences-provider";
import { formatDateTime, formatNumber } from "./preferences";
import { StateColourIndicators } from "./state-indicator";

type BasketDenial = IdentityDenial | InventoryDenial | LicensingDenial;
type BasketKind = "basket" | "ordered";
type BasketRoute = { readonly kind: BasketKind };
type QuantityValidation = { readonly itemId: string; readonly message: string };

const RELOADABLE_DENIAL_CODES = new Set<InventoryDenial["code"]>([
  "reorder-item-not-found",
  "reorder-item-status-invalid",
  "reorder-product-inactive",
  "version-conflict",
]);

export function basketRoute(hash: string): BasketRoute {
  return hash === "#/basket/ordered" ? { kind: "ordered" } : { kind: "basket" };
}

export function BasketRouteView({
  baseUrl,
  checkNow,
  hash,
}: {
  readonly baseUrl: string;
  readonly checkNow: () => Promise<void>;
  readonly hash: string;
}): React.JSX.Element {
  const route = basketRoute(hash);
  const { state: identity } = useIdentityState();
  const canManage =
    identity?.state === "authenticated" &&
    identity.allowedPermissions.includes("inventory.reorder.manage");
  const canConfirm =
    identity?.state === "authenticated" &&
    identity.allowedPermissions.includes("inventory.reorder.confirm");
  const canReviewInventory =
    identity?.state === "authenticated" &&
    identity.allowedPermissions.includes("inventory.review");

  return (
    <BasketScreen
      baseUrl={baseUrl}
      canConfirm={canConfirm}
      canManage={canManage}
      canReviewInventory={canReviewInventory}
      checkNow={checkNow}
      route={route}
    />
  );
}

function BasketScreen({
  baseUrl,
  canConfirm,
  canManage,
  canReviewInventory,
  checkNow,
  route,
}: {
  readonly baseUrl: string;
  readonly canConfirm: boolean;
  readonly canManage: boolean;
  readonly canReviewInventory: boolean;
  readonly checkNow: () => Promise<void>;
  readonly route: BasketRoute;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = basketMessages[locale];
  const inventoryCopy = inventoryMessages[locale];
  const [items, setItems] = useState<ReorderItem[] | null>(null);
  const [quantityValues, setQuantityValues] = useState<Record<string, string>>(
    {},
  );
  const [failedRows, setFailedRows] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denial, setDenial] = useState<BasketDenial | null>(null);
  const [validation, setValidation] = useState<QuantityValidation | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const sequence = useRef(0);
  const pendingQuantityCommits = useRef(new Set<string>());
  const attemptRef = useRef<ReturnType<typeof inventoryCommandAttempt> | null>(
    null,
  );
  const requestCommittedFocus = useCommittedFocus();

  const load = useCallback(async (): Promise<ReorderItem[] | null> => {
    const current = ++sequence.current;
    setError(null);
    setDenial(null);
    try {
      const result = await readReorderBasket(baseUrl);
      if (sequence.current !== current) return null;
      setItems(result.items);
      const itemIds = new Set(result.items.map((item) => item.id));
      setQuantityValues((previous) => {
        const next = { ...previous };
        for (const item of result.items) {
          if (next[item.id] === undefined) next[item.id] = item.quantity;
        }
        for (const itemId of Object.keys(next)) {
          if (!itemIds.has(itemId)) delete next[itemId];
        }
        return next;
      });
      setFailedRows(
        (previous) =>
          new Set([...previous].filter((itemId) => itemIds.has(itemId))),
      );
      return result.items;
    } catch (caught) {
      if (sequence.current !== current) return null;
      if (
        caught instanceof InventoryApiDenied ||
        caught instanceof IdentityApiDenied ||
        caught instanceof LicensingApiDenied
      ) {
        setDenial(caught.denial);
      } else {
        setError(copy.reviewUnavailable);
      }
      return null;
    }
  }, [baseUrl, copy.reviewUnavailable]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleItems = useMemo(
    () => (items ?? []).filter((item) => item.status === route.kind),
    [items, route.kind],
  );

  function quantityValue(item: ReorderItem): string {
    return quantityValues[item.id] ?? item.quantity;
  }

  function markFailed(itemId: string, failed: boolean): void {
    setFailedRows((previous) => {
      const next = new Set(previous);
      if (failed) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  function focusQuantity(itemId: string): void {
    requestCommittedFocus(
      () =>
        document.getElementById(`basket-quantity-${itemId}`) ??
        document.getElementById(`basket-tab-${route.kind}`),
    );
  }

  function focusRowControl(
    item: ReorderItem,
    kind: "confirm" | "remove" | "return",
  ): void {
    requestCommittedFocus(
      () =>
        document.getElementById(`basket-${kind}-${item.id}`) ??
        document.getElementById(`basket-quantity-${item.id}`) ??
        document.getElementById(`basket-tab-${route.kind}`),
    );
  }

  function focusAfterRow(itemId: string, rows: readonly ReorderItem[]): void {
    const index = rows.findIndex((item) => item.id === itemId);
    const nextItem = index < 0 ? undefined : rows[index + 1];
    requestCommittedFocus(() => {
      if (nextItem !== undefined) {
        const row = document.getElementById(`basket-row-${nextItem.id}`);
        const control = row?.querySelector<HTMLElement>(
          "input:not([disabled]), button:not([disabled])",
        );
        if (control !== null && control !== undefined) return control;
      }
      return document.getElementById(`basket-tab-${route.kind}`);
    });
  }

  async function reloadAfterConflict(item: ReorderItem): Promise<void> {
    const refreshed = await load();
    if (refreshed === null) {
      focusQuantity(item.id);
      return;
    }
    const current = refreshed?.find((candidate) => candidate.id === item.id);
    setAnnouncement(
      current === undefined
        ? copy.refreshedAnnouncement(
            item.product.displayName,
            formatNumber(BigInt(item.quantity), locale),
            item.product.inventoryUnitName,
          )
        : copy.refreshedAnnouncement(
            current.product.displayName,
            formatNumber(BigInt(current.quantity), locale),
            current.product.inventoryUnitName,
          ),
    );
    focusQuantity(item.id);
  }

  async function commitQuantity(
    item: ReorderItem,
    rawValue: string,
  ): Promise<void> {
    if (busyItemId !== null || pendingQuantityCommits.current.has(item.id)) {
      return;
    }
    const value = rawValue.trim();
    if (!/^\d+$/u.test(value)) {
      setValidation({ itemId: item.id, message: copy.quantityInvalid });
      focusQuantity(item.id);
      return;
    }
    const normalized = normalizedCount(value);
    if (normalized === item.quantity) {
      setQuantityValues((previous) => ({
        ...previous,
        [item.id]: normalized,
      }));
      setValidation(null);
      markFailed(item.id, false);
      return;
    }

    pendingQuantityCommits.current.add(item.id);
    const attempt = inventoryCommandAttempt(
      attemptRef.current,
      JSON.stringify({
        itemId: item.id,
        value: normalized,
        version: item.version,
      }),
    );
    attemptRef.current = attempt;
    const currentSequence = ++sequence.current;
    setBusyItemId(item.id);
    setValidation(null);
    setDenial(null);
    try {
      const result = await updateReorderItemQuantity(baseUrl, item.id, {
        expectedVersion: item.version,
        idempotencyKey: attempt.idempotencyKey,
        quantity: normalized,
      });
      if (sequence.current !== currentSequence) return;
      setItems(
        (previous) =>
          previous?.map((candidate) =>
            candidate.id === result.item.id ? result.item : candidate,
          ) ?? previous,
      );
      setQuantityValues((previous) => ({
        ...previous,
        [result.item.id]: result.item.quantity,
      }));
      markFailed(item.id, false);
      setAnnouncement(
        copy.savedAnnouncement(
          result.item.product.displayName,
          formatNumber(BigInt(result.item.quantity), locale),
          result.item.product.inventoryUnitName,
          projectionSummary(result.item, locale),
        ),
      );
    } catch (caught) {
      if (sequence.current !== currentSequence) return;
      if (caught instanceof InventoryApiDenied) {
        if (RELOADABLE_DENIAL_CODES.has(caught.denial.code)) {
          await reloadAfterConflict(item);
        } else {
          setDenial(caught.denial);
          focusQuantity(item.id);
        }
      } else if (
        caught instanceof IdentityApiDenied ||
        caught instanceof LicensingApiDenied
      ) {
        setDenial(caught.denial);
        focusQuantity(item.id);
      } else {
        markFailed(item.id, true);
        setAnnouncement(copy.notSaved);
        focusQuantity(item.id);
      }
    } finally {
      pendingQuantityCommits.current.delete(item.id);
      setBusyItemId(null);
    }
  }

  async function retryQuantity(item: ReorderItem): Promise<void> {
    await commitQuantity(item, quantityValue(item));
  }

  async function transition(
    item: ReorderItem,
    kind: "confirm" | "remove" | "return",
  ): Promise<void> {
    if (busyItemId !== null) return;
    const attempt = inventoryCommandAttempt(
      attemptRef.current,
      JSON.stringify({ command: kind, itemId: item.id, version: item.version }),
    );
    attemptRef.current = attempt;
    const currentSequence = ++sequence.current;
    const currentRows = visibleItems;
    setBusyItemId(item.id);
    setError(null);
    setDenial(null);
    try {
      if (kind === "remove") {
        const result = await removeReorderItem(baseUrl, item.id, {
          expectedVersion: item.version,
          idempotencyKey: attempt.idempotencyKey,
        });
        if (sequence.current !== currentSequence) return;
        setItems(
          (previous) =>
            previous?.filter((candidate) => candidate.id !== result.itemId) ??
            previous,
        );
        setAnnouncement(copy.removedAnnouncement(item.product.displayName));
      } else {
        const result =
          kind === "confirm"
            ? await confirmReorderItem(baseUrl, item.id, {
                expectedVersion: item.version,
                idempotencyKey: attempt.idempotencyKey,
              })
            : await returnReorderItem(baseUrl, item.id, {
                expectedVersion: item.version,
                idempotencyKey: attempt.idempotencyKey,
              });
        if (sequence.current !== currentSequence) return;
        setItems(
          (previous) =>
            previous?.map((candidate) =>
              candidate.id === result.item.id ? result.item : candidate,
            ) ?? previous,
        );
        setAnnouncement(
          kind === "confirm"
            ? copy.confirmedAnnouncement(item.product.displayName)
            : copy.returnedAnnouncement(item.product.displayName),
        );
      }
      focusAfterRow(item.id, currentRows);
    } catch (caught) {
      if (sequence.current !== currentSequence) return;
      if (caught instanceof InventoryApiDenied) {
        if (RELOADABLE_DENIAL_CODES.has(caught.denial.code)) {
          await reloadAfterConflict(item);
        } else {
          setDenial(caught.denial);
          focusRowControl(item, kind);
        }
      } else if (
        caught instanceof IdentityApiDenied ||
        caught instanceof LicensingApiDenied
      ) {
        setDenial(caught.denial);
        focusRowControl(item, kind);
      } else {
        setError(copy.reviewUnavailable);
        setAnnouncement(copy.notSaved);
        focusRowControl(item, kind);
      }
    } finally {
      setBusyItemId(null);
    }
  }

  if (items === null && (error !== null || denial !== null)) {
    const message =
      denial === null
        ? (error ?? copy.reviewUnavailable)
        : denialMessage(denial, copy);
    return (
      <BasketFailure
        message={message}
        onRetry={async () => {
          await checkNow();
          await load();
        }}
        retry={copy.actions.retry}
      />
    );
  }
  if (items === null) {
    return (
      <section className="basket-workspace">
        <p role="status">{copy.loading}</p>
      </section>
    );
  }

  return (
    <section className="basket-workspace" aria-labelledby="basket-title">
      <nav className="purchase-view-tabs" aria-label={copy.title}>
        <a
          id="basket-tab-basket"
          aria-current={route.kind === "basket" ? "page" : undefined}
          className="purchase-view-tab"
          data-basket-tab="basket"
          href="#/basket"
        >
          {copy.tabs.basket}
        </a>
        <a
          id="basket-tab-ordered"
          aria-current={route.kind === "ordered" ? "page" : undefined}
          className="purchase-view-tab"
          data-basket-tab="ordered"
          href="#/basket/ordered"
        >
          {copy.tabs.ordered}
        </a>
      </nav>
      <header className="inventory-heading basket-heading">
        <div>
          <h2 id="basket-title">
            {route.kind === "basket" ? copy.tabs.basket : copy.tabs.ordered}
          </h2>
          <p>{copy.description}</p>
        </div>
      </header>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      {denial === null ? null : (
        <div className="denial-alert" role="alert">
          <p>
            {denialMessage(denial, copy)}
            <small>{denial.requestId}</small>
          </p>
        </div>
      )}
      {error === null ? null : (
        <div className="denial-alert" role="alert">
          <p>{error}</p>
        </div>
      )}
      {visibleItems.length === 0 ? (
        <p role="status">
          {route.kind === "basket" ? copy.empty : copy.emptyOrdered}
        </p>
      ) : route.kind === "basket" ? (
        <BasketTable
          canConfirm={canConfirm}
          canManage={canManage}
          canReviewInventory={canReviewInventory}
          copy={copy}
          failedRows={failedRows}
          inventoryCopy={inventoryCopy}
          items={visibleItems}
          locale={locale}
          quantityValue={quantityValue}
          validation={validation}
          onBlurQuantity={(item, value) => void commitQuantity(item, value)}
          onChangeQuantity={(itemId, value) => {
            setQuantityValues((previous) => ({ ...previous, [itemId]: value }));
            if (validation?.itemId === itemId) setValidation(null);
          }}
          onConfirm={(item) => void transition(item, "confirm")}
          onRemove={(item) => void transition(item, "remove")}
          onRetry={(item) => void retryQuantity(item)}
          busyItemId={busyItemId}
        />
      ) : (
        <OrderedTable
          canConfirm={canConfirm}
          canReviewInventory={canReviewInventory}
          copy={copy}
          items={visibleItems}
          locale={locale}
          onReturn={(item) => void transition(item, "return")}
          busyItemId={busyItemId}
        />
      )}
    </section>
  );
}

function BasketTable({
  busyItemId,
  canConfirm,
  canManage,
  canReviewInventory,
  copy,
  failedRows,
  inventoryCopy,
  items,
  locale,
  onBlurQuantity,
  onChangeQuantity,
  onConfirm,
  onRemove,
  onRetry,
  quantityValue,
  validation,
}: {
  readonly busyItemId: string | null;
  readonly canConfirm: boolean;
  readonly canManage: boolean;
  readonly canReviewInventory: boolean;
  readonly copy: BasketCopy;
  readonly failedRows: ReadonlySet<string>;
  readonly inventoryCopy: InventoryCopy;
  readonly items: readonly ReorderItem[];
  readonly locale: "ar" | "en";
  readonly onBlurQuantity: (item: ReorderItem, value: string) => void;
  readonly onChangeQuantity: (itemId: string, value: string) => void;
  readonly onConfirm: (item: ReorderItem) => void;
  readonly onRemove: (item: ReorderItem) => void;
  readonly onRetry: (item: ReorderItem) => void;
  readonly quantityValue: (item: ReorderItem) => string;
  readonly validation: QuantityValidation | null;
}): React.JSX.Element {
  return (
    <div className="basket-table-scroll">
      <table className="basket-table">
        <caption className="visually-hidden">{copy.tabs.basket}</caption>
        <thead>
          <tr>
            <th scope="col">{copy.columns.item}</th>
            <th scope="col">{copy.columns.balance}</th>
            <th scope="col">{copy.columns.levels}</th>
            <th scope="col">{copy.columns.consumption}</th>
            <th scope="col">{copy.columns.risk}</th>
            <th scope="col">{copy.columns.quantity}</th>
            <th scope="col">{copy.columns.projection}</th>
            <th scope="col">{copy.columns.actions}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <BasketRow
              busy={busyItemId !== null}
              canConfirm={canConfirm}
              canManage={canManage}
              canReviewInventory={canReviewInventory}
              copy={copy}
              failed={failedRows.has(item.id)}
              inventoryCopy={inventoryCopy}
              item={item}
              key={item.id}
              locale={locale}
              quantityValue={quantityValue(item)}
              validation={validation?.itemId === item.id ? validation : null}
              onBlurQuantity={onBlurQuantity}
              onChangeQuantity={onChangeQuantity}
              onConfirm={onConfirm}
              onRemove={onRemove}
              onRetry={onRetry}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BasketRow({
  busy,
  canConfirm,
  canManage,
  canReviewInventory,
  copy,
  failed,
  inventoryCopy,
  item,
  locale,
  onBlurQuantity,
  onChangeQuantity,
  onConfirm,
  onRemove,
  onRetry,
  quantityValue,
  validation,
}: {
  readonly busy: boolean;
  readonly canConfirm: boolean;
  readonly canManage: boolean;
  readonly canReviewInventory: boolean;
  readonly copy: BasketCopy;
  readonly failed: boolean;
  readonly inventoryCopy: InventoryCopy;
  readonly item: ReorderItem;
  readonly locale: "ar" | "en";
  readonly onBlurQuantity: (item: ReorderItem, value: string) => void;
  readonly onChangeQuantity: (itemId: string, value: string) => void;
  readonly onConfirm: (item: ReorderItem) => void;
  readonly onRemove: (item: ReorderItem) => void;
  readonly onRetry: (item: ReorderItem) => void;
  readonly quantityValue: string;
  readonly validation: QuantityValidation | null;
}): React.JSX.Element {
  const inactive = item.product.status !== "active";
  const displayQuantity = /^\d+$/u.test(quantityValue.trim())
    ? BigInt(quantityValue.trim())
    : BigInt(item.quantity);
  const captionParts = describeInventoryUnits(
    item.product.inventoryUnitName,
    item.product.packageUnits,
    displayQuantity,
  ).map<BasketQuantityPart>((part) => ({
    count: formatNumber(part.count, locale),
    unitName: part.unitName,
  }));
  const captionId = `basket-quantity-caption-${item.id}`;
  const validationId = `basket-quantity-error-${item.id}`;
  const describedBy =
    validation === null ? captionId : `${captionId} ${validationId}`;

  return (
    <tr
      data-basket-row={item.id}
      data-saved={failed ? "false" : undefined}
      id={`basket-row-${item.id}`}
    >
      <th scope="row">
        <BasketItemName
          canReviewInventory={canReviewInventory}
          copy={copy}
          item={item}
        />
      </th>
      <td>
        <bdi>{formatNumber(BigInt(item.inventory.balance), locale)}</bdi>{" "}
        {item.product.inventoryUnitName}
      </td>
      <td>
        <bdi>{formatLevels(item, locale)}</bdi>
      </td>
      <td>
        <bdi>
          {formatNumber(
            BigInt(item.inventory.consumptionRatePer30Days),
            locale,
          )}
        </bdi>
      </td>
      <td>
        <StateColourIndicators
          copy={inventoryCopy}
          riskIndicators={item.inventory.riskIndicators}
          stateColour={item.inventory.stateColour}
        />
      </td>
      <td>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onBlurQuantity(item, quantityValue);
          }}
        >
          <input
            aria-describedby={describedBy}
            aria-invalid={validation === null ? undefined : true}
            aria-label={copy.quantityLabel(item.product.displayName)}
            className="basket-quantity"
            data-basket-field={`quantity:${item.id}`}
            disabled={inactive || !canManage || busy}
            id={`basket-quantity-${item.id}`}
            inputMode="numeric"
            type="text"
            value={quantityValue}
            onBlur={(event) => onBlurQuantity(item, event.currentTarget.value)}
            onChange={(event) => onChangeQuantity(item.id, event.target.value)}
          />
        </form>
        <small className="basket-quantity-caption" id={captionId}>
          {copy.quantityCaption(captionParts)}
        </small>
        {validation === null ? null : (
          <p className="denial-alert" id={validationId} role="alert">
            {validation.message}
          </p>
        )}
        {item.proposal.quantity === "0" ? (
          <small className="basket-proposal-basis">
            {copy.proposalBasis[item.proposal.basis]}
          </small>
        ) : null}
        {failed ? (
          <div className="basket-not-saved">
            <span>{copy.notSaved}</span>
            <button
              className="quiet-button"
              data-basket-retry={item.id}
              disabled={busy}
              type="button"
              onClick={() => onRetry(item)}
            >
              {copy.actions.retry}
            </button>
          </div>
        ) : null}
      </td>
      <td>
        <Projection item={item} locale={locale} copy={copy} />
      </td>
      <td>
        <div className="basket-row-actions">
          {canManage ? (
            <button
              className="quiet-button"
              data-basket-action={`remove:${item.id}`}
              disabled={busy}
              id={`basket-remove-${item.id}`}
              type="button"
              onClick={() => onRemove(item)}
            >
              {copy.actions.remove}
            </button>
          ) : null}
          {canConfirm && !inactive ? (
            <button
              className="primary-button"
              data-basket-action={`confirm:${item.id}`}
              disabled={busy}
              id={`basket-confirm-${item.id}`}
              type="button"
              onClick={() => onConfirm(item)}
            >
              {copy.actions.confirm}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function OrderedTable({
  busyItemId,
  canConfirm,
  canReviewInventory,
  copy,
  items,
  locale,
  onReturn,
}: {
  readonly busyItemId: string | null;
  readonly canConfirm: boolean;
  readonly canReviewInventory: boolean;
  readonly copy: BasketCopy;
  readonly items: readonly ReorderItem[];
  readonly locale: "ar" | "en";
  readonly onReturn: (item: ReorderItem) => void;
}): React.JSX.Element {
  return (
    <div className="basket-table-scroll">
      <table className="basket-table basket-ordered-table">
        <caption className="visually-hidden">{copy.tabs.ordered}</caption>
        <thead>
          <tr>
            <th scope="col">{copy.columns.item}</th>
            <th scope="col">{copy.columns.quantity}</th>
            <th scope="col">{copy.columns.status}</th>
            <th scope="col">{copy.columns.orderDate}</th>
            <th scope="col">{copy.columns.orderedBy}</th>
            <th scope="col">{copy.columns.actions}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              data-basket-row={item.id}
              id={`basket-row-${item.id}`}
              key={item.id}
            >
              <th scope="row">
                <BasketItemName
                  canReviewInventory={canReviewInventory}
                  copy={copy}
                  item={item}
                />
              </th>
              <td>
                <bdi>{formatNumber(BigInt(item.quantity), locale)}</bdi>{" "}
                {item.product.inventoryUnitName}
                <small className="basket-quantity-caption">
                  {copy.quantityCaption(
                    describeInventoryUnits(
                      item.product.inventoryUnitName,
                      item.product.packageUnits,
                      BigInt(item.quantity),
                    ).map<BasketQuantityPart>((part) => ({
                      count: formatNumber(part.count, locale),
                      unitName: part.unitName,
                    })),
                  )}
                </small>
              </td>
              <td>
                <span className="basket-ordered-status">
                  <OrderedIcon />
                  <span>{copy.statusLabels.ordered}</span>
                </span>
              </td>
              <td>
                {item.orderedAt === null ? (
                  "—"
                ) : (
                  <bdi>{formatDateTime(new Date(item.orderedAt), locale)}</bdi>
                )}
              </td>
              <td>{item.orderedBy?.displayName ?? "—"}</td>
              <td>
                {canConfirm ? (
                  <button
                    className="quiet-button"
                    data-basket-action={`return:${item.id}`}
                    disabled={busyItemId !== null}
                    id={`basket-return-${item.id}`}
                    type="button"
                    onClick={() => onReturn(item)}
                  >
                    {copy.actions.returnToBasket}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BasketItemName({
  canReviewInventory,
  copy,
  item,
}: {
  readonly canReviewInventory: boolean;
  readonly copy: BasketCopy;
  readonly item: ReorderItem;
}): React.JSX.Element {
  // An ordered row cannot be removed directly (docs: return first), so its
  // archived label names the action that is actually available.
  const productState =
    item.product.status === "active"
      ? null
      : item.product.status === "archived"
        ? item.status === "ordered"
          ? copy.archivedOrderedRow
          : copy.archivedRow
        : copy.mergedRow(item.product.mergedIntoDisplayName);
  const mergedTargetId =
    item.product.status === "merged" ? item.product.mergedIntoProductId : null;
  const name = canReviewInventory ? (
    <a
      className="table-link"
      data-basket-item-link={item.productId}
      href={`#/inventory/items/${item.productId}/movements`}
    >
      {item.product.displayName}
    </a>
  ) : (
    <span>{item.product.displayName}</span>
  );
  return (
    <div className="basket-item-name">
      {name}
      {productState === null ? null : (
        <span className="basket-product-state">
          <ArchivedIcon />
          {canReviewInventory && mergedTargetId !== null ? (
            <a
              className="table-link"
              data-basket-merged-link={mergedTargetId}
              href={`#/inventory/items/${mergedTargetId}/movements`}
            >
              {productState}
            </a>
          ) : (
            <span>{productState}</span>
          )}
        </span>
      )}
    </div>
  );
}

function Projection({
  copy,
  item,
  locale,
}: {
  readonly copy: BasketCopy;
  readonly item: ReorderItem;
  readonly locale: "ar" | "en";
}): React.JSX.Element {
  // The server projects against the product's current maximum level, not
  // the level snapshotted at proposal time, so the cell reads the same fact.
  const maximumLevel = item.inventory.stockLevels.maximumLevel;
  if (item.projection.warning === "surplus" && maximumLevel !== null) {
    return (
      <span
        className="basket-warning"
        data-warning="surplus"
        title={copy.projectionWarnings.surplus}
      >
        <WarningIcon />
        <span>
          {copy.surplusWarning(
            formatNumber(BigInt(item.projection.projectedLevel), locale),
            formatNumber(BigInt(maximumLevel), locale),
          )}
        </span>
      </span>
    );
  }
  return maximumLevel === null ? <span /> : <span>{copy.withinMaximum}</span>;
}

function projectionSummary(
  item: ReorderItem,
  locale: "ar" | "en",
): BasketProjectionSummary {
  return {
    maximumLevel:
      item.inventory.stockLevels.maximumLevel === null
        ? null
        : formatNumber(BigInt(item.inventory.stockLevels.maximumLevel), locale),
    projectedLevel: formatNumber(
      BigInt(item.projection.projectedLevel),
      locale,
    ),
    warning: item.projection.warning,
  };
}

function formatLevels(item: ReorderItem, locale: "ar" | "en"): string {
  const minimum =
    item.inventory.stockLevels.minimumLevel === null
      ? "—"
      : formatNumber(BigInt(item.inventory.stockLevels.minimumLevel), locale);
  const maximum =
    item.inventory.stockLevels.maximumLevel === null
      ? "—"
      : formatNumber(BigInt(item.inventory.stockLevels.maximumLevel), locale);
  return `${minimum} / ${maximum}`;
}

function denialMessage(denial: BasketDenial, copy: BasketCopy): string {
  if (
    "code" in denial &&
    BASKET_DENIAL_CODES.includes(denial.code as BasketDenialCode)
  ) {
    return copy.denialMessages[denial.code as BasketDenialCode];
  }
  return copy.permissionDenied;
}

function BasketFailure({
  message,
  onRetry,
  retry,
}: {
  readonly message: string;
  readonly onRetry: () => Promise<void>;
  readonly retry: string;
}): React.JSX.Element {
  return (
    <section className="basket-workspace">
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

function WarningIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="basket-warning-icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="m12 4 9 16H3L12 4Z" />
      <path d="M12 9v5" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function ArchivedIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="basket-product-state-icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M4 7h16v13H4z" />
      <path d="M3 4h18v3H3zM9 11h6" />
    </svg>
  );
}

function OrderedIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="basket-ordered-status-icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}
