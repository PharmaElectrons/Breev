import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  PRODUCT_PRICING_FIELD_EDITABILITY,
  type Product,
  type PurchaseDraftDetail,
  type PurchaseEntryColumnField,
  type PurchaseEntryPreferences,
} from "@breev/contracts/local-rest";
import { searchProducts } from "./catalog-api";
import { ProductForm } from "./product-form";
import {
  commitPurchaseDraftRow,
  purchasingCommandAttempt,
  PurchasingApiDenied,
  requestPurchaseEntryPreferences,
  updatePurchaseEntryPreferences,
  type PurchasingCommandAttempt,
} from "./purchasing-api";
import { purchasingMessages } from "./purchasing-messages";
import { usePreferences } from "./preferences-provider";

interface PurchaseRowEntryProps {
  readonly baseUrl: string;
  readonly draft: PurchaseDraftDetail;
  readonly onDraftChanged: (draft: PurchaseDraftDetail) => void;
}

const FIELD_COPY = {
  cost: "rowCost",
  expiry: "rowExpiry",
  item: "itemBarcode",
  quantity: "rowQuantity",
  "selling-price": "sellingPrice",
} as const;
const PANEL_COPY = {
  category: "category",
  packaging: "packaging",
  "scientific-name": "scientificName",
  "wholesale-price": "wholesalePrice",
} as const;

export function PurchaseRowEntry({
  baseUrl,
  draft,
  onDraftChanged,
}: PurchaseRowEntryProps): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const [preferences, setPreferences] =
    useState<PurchaseEntryPreferences | null>(null);
  const [settingsDraft, setSettingsDraft] =
    useState<PurchaseEntryPreferences | null>(null);
  const [itemQuery, setItemQuery] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [costFils, setCostFils] = useState("0");
  const [retailPriceFils, setRetailPriceFils] = useState("0");
  const [marginPercentage, setMarginPercentage] = useState("0");
  const [expiryDate, setExpiryDate] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [unitKey, setUnitKey] = useState("inventory-unit");
  const [quickCreateValue, setQuickCreateValue] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{
    field: PurchaseEntryColumnField;
    sequence: number;
  } | null>(null);
  const [entryEpoch, setEntryEpoch] = useState(1);
  const fieldRefs = useRef<
    Partial<Record<PurchaseEntryColumnField, HTMLElement | null>>
  >({});
  const optionalUnitRef = useRef<HTMLSelectElement>(null);
  const rowAttempt = useRef<PurchasingCommandAttempt | null>(null);
  const preferencesAttempt = useRef<PurchasingCommandAttempt | null>(null);
  const initialFocusDone = useRef(false);
  const focusSequence = useRef(0);

  useEffect(() => {
    let live = true;
    void requestPurchaseEntryPreferences(baseUrl)
      .then((value) => {
        if (!live) return;
        setPreferences(value);
        setSettingsDraft(value);
      })
      .catch(() => live && setError(copy.apiUnavailable));
    return () => {
      live = false;
    };
  }, [baseUrl, copy.apiUnavailable]);

  useEffect(() => {
    if (preferences === null || initialFocusDone.current) return;
    initialFocusDone.current = true;
    const first = purchaseEntryProgression(preferences, null)[0] ?? "item";
    const timer = window.setTimeout(() => fieldRefs.current[first]?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [preferences]);

  useEffect(() => {
    if (busy || focusRequest === null) return;
    const element = fieldRefs.current[focusRequest.field];
    if (
      element === null ||
      element === undefined ||
      element.matches(":disabled")
    )
      return;
    element.focus();
    setFocusRequest(null);
  }, [busy, focusRequest]);

  function focusField(field: PurchaseEntryColumnField): void {
    focusSequence.current += 1;
    setFocusRequest({ field, sequence: focusSequence.current });
  }

  function attachProduct(next: Product, returnToItem = false): void {
    setProduct(next);
    setItemQuery(next.displayName);
    setRetailPriceFils(next.pricing.retailPriceFils);
    setMarginPercentage(
      next.pricing.method === "by-percentage"
        ? next.pricing.marginPercentage
        : "0",
    );
    setUnitKey(unitToKey(next.packaging.defaultUnits.purchase));
    setError(null);
    if (returnToItem) focusField("item");
  }

  async function resolveItemAndAdvance(): Promise<void> {
    const query = itemQuery.trim();
    if (product !== null && query === product.displayName) {
      focusNext("item", product);
      return;
    }
    if (query === "") {
      setError(copy.itemRequired);
      focusField("item");
      return;
    }
    setBusy(true);
    try {
      const result = await searchProducts(baseUrl, { limit: "20", query });
      const exactBarcode = result.results.find(
        ({ matchedBarcode }) => matchedBarcode?.value === query,
      );
      const selected = exactBarcode?.product ?? result.results[0]?.product;
      if (selected === undefined) {
        setQuickCreateValue(query);
        setBusy(false);
        return;
      }
      attachProduct(selected);
      setBusy(false);
      focusNext("item", selected);
    } catch {
      setError(copy.apiUnavailable);
      setBusy(false);
      focusField("item");
    }
  }

  function focusNext(
    current: PurchaseEntryColumnField,
    selectedProduct = product,
  ): void {
    const fields = purchaseEntryProgression(preferences, selectedProduct);
    const index = fields.indexOf(current);
    const next = fields[index + 1];
    if (next === undefined) {
      void commitRow(current, selectedProduct);
    } else {
      focusField(next);
    }
  }

  function onFieldEnter(
    field: PurchaseEntryColumnField,
    event: KeyboardEvent<HTMLElement>,
  ): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    if (field === "item") {
      void resolveItemAndAdvance();
      return;
    }
    if (field === "quantity" && !isPositiveInteger(quantity)) {
      setError(copy.quantityInvalid);
      focusField(field);
      return;
    }
    if (field === "cost" && !isUnsignedInteger(costFils)) {
      setError(copy.costInvalid);
      focusField(field);
      return;
    }
    setError(null);
    focusNext(field);
  }

  async function commitRow(
    lastField: PurchaseEntryColumnField,
    selectedProduct = product,
  ): Promise<void> {
    if (selectedProduct === null) {
      setError(copy.itemRequired);
      focusField("item");
      return;
    }
    if (!isPositiveInteger(quantity)) {
      setError(copy.quantityInvalid);
      focusField("quantity");
      return;
    }
    if (!isUnsignedInteger(costFils)) {
      setError(copy.costInvalid);
      focusField("cost");
      return;
    }
    const unit = keyToUnit(unitKey);
    const pricing =
      selectedProduct.pricing.method === "by-price"
        ? ({ method: "by-price", retailPriceFils } as const)
        : ({ marginPercentage, method: "by-percentage" } as const);
    const body = {
      costFils,
      enteredQuantity: quantity,
      expectedVersion: draft.version,
      expiryDate: expiryDate === "" ? null : expiryDate,
      itemId: selectedProduct.id,
      lotNumber: lotNumber.trim() === "" ? null : lotNumber.trim(),
      notes: notes.trim() === "" ? null : notes.trim(),
      pricing,
      unit,
    };
    const attempt = purchasingCommandAttempt(
      rowAttempt.current,
      JSON.stringify({ body, draftId: draft.id }),
    );
    rowAttempt.current = attempt;
    setBusy(true);
    setError(null);
    try {
      const result = await commitPurchaseDraftRow(baseUrl, draft.id, {
        ...body,
        idempotencyKey: attempt.idempotencyKey,
      });
      rowAttempt.current = null;
      onDraftChanged(result.draft);
      setMessage(copy.rowCommitted);
      resetLine();
      const nextFocus =
        preferences?.afterCommit === "return-to-item"
          ? "item"
          : (purchaseEntryProgression(preferences, null)[0] ?? "item");
      if (preferences?.afterCommit === "new-row")
        setEntryEpoch((value) => value + 1);
      focusField(nextFocus);
    } catch (caught) {
      setError(
        caught instanceof PurchasingApiDenied
          ? copy.rowError
          : copy.apiUnavailable,
      );
      focusField(lastField);
    } finally {
      setBusy(false);
    }
  }

  function resetLine(): void {
    setItemQuery("");
    setProduct(null);
    setQuantity("1");
    setCostFils("0");
    setRetailPriceFils("0");
    setMarginPercentage("0");
    setExpiryDate("");
    setLotNumber("");
    setNotes("");
    setUnitKey("inventory-unit");
  }

  async function savePreferences(): Promise<void> {
    if (settingsDraft === null) return;
    const fingerprint = JSON.stringify(settingsDraft);
    const attempt = purchasingCommandAttempt(
      preferencesAttempt.current,
      fingerprint,
    );
    preferencesAttempt.current = attempt;
    try {
      const saved = await updatePurchaseEntryPreferences(baseUrl, {
        afterCommit: settingsDraft.afterCommit,
        columns: settingsDraft.columns,
        detailsPanelFields: settingsDraft.detailsPanelFields,
        expectedRevision: settingsDraft.revision,
        idempotencyKey: attempt.idempotencyKey,
      });
      preferencesAttempt.current = null;
      setPreferences(saved);
      setSettingsDraft(saved);
      setMessage(copy.settingsSaved);
    } catch {
      setError(copy.apiUnavailable);
    }
  }

  function moveColumn(index: number, delta: -1 | 1): void {
    if (settingsDraft === null) return;
    const target = index + delta;
    if (target < 0 || target >= settingsDraft.columns.length) return;
    const columns = [...settingsDraft.columns];
    [columns[index], columns[target]] = [columns[target]!, columns[index]!];
    setSettingsDraft({ ...settingsDraft, columns });
  }

  const visibleColumns =
    preferences?.columns.filter(({ visible }) => visible) ?? [];

  return (
    <section
      className="purchase-row-workspace"
      aria-labelledby="purchase-row-title"
      data-purchase-editor
    >
      <div className="purchase-row-heading">
        <div>
          <h2 id="purchase-row-title">{copy.rowEntry}</h2>
          <p>
            {draft.rows.length === 0 ? copy.noRows : `${draft.rows.length}`}
          </p>
        </div>
        <details className="purchase-entry-settings">
          <summary>{copy.columnSettings}</summary>
          {settingsDraft === null ? null : (
            <div className="purchase-entry-settings-body">
              <ol>
                {settingsDraft.columns.map((column, index) => (
                  <li key={column.field}>
                    <span>{copy[FIELD_COPY[column.field]]}</span>
                    <label>
                      <input
                        type="checkbox"
                        checked={column.visible}
                        disabled={column.field === "item"}
                        onChange={(event) => {
                          const columns = settingsDraft.columns.map(
                            (candidate) =>
                              candidate.field === column.field
                                ? {
                                    ...candidate,
                                    visible: event.target.checked,
                                  }
                                : candidate,
                          );
                          setSettingsDraft({ ...settingsDraft, columns });
                        }}
                      />
                      {copy.visible}
                    </label>
                    <button
                      type="button"
                      className="quiet-button"
                      disabled={index === 0}
                      aria-label={`${copy.moveEarlier}: ${copy[FIELD_COPY[column.field]]}`}
                      onClick={() => moveColumn(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="quiet-button"
                      disabled={index === settingsDraft.columns.length - 1}
                      aria-label={`${copy.moveLater}: ${copy[FIELD_COPY[column.field]]}`}
                      onClick={() => moveColumn(index, 1)}
                    >
                      ↓
                    </button>
                  </li>
                ))}
              </ol>
              <fieldset>
                <legend>{copy.afterCommit}</legend>
                <label>
                  <input
                    type="radio"
                    checked={settingsDraft.afterCommit === "new-row"}
                    onChange={() =>
                      setSettingsDraft({
                        ...settingsDraft,
                        afterCommit: "new-row",
                      })
                    }
                  />
                  {copy.newRow}
                </label>
                <label>
                  <input
                    type="radio"
                    checked={settingsDraft.afterCommit === "return-to-item"}
                    onChange={() =>
                      setSettingsDraft({
                        ...settingsDraft,
                        afterCommit: "return-to-item",
                      })
                    }
                  />
                  {copy.returnToItem}
                </label>
              </fieldset>
              <fieldset>
                <legend>{copy.detailsPanel}</legend>
                {Object.entries(PANEL_COPY).map(([field, message]) => (
                  <label key={field}>
                    <input
                      type="checkbox"
                      checked={settingsDraft.detailsPanelFields.includes(
                        field as keyof typeof PANEL_COPY,
                      )}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [
                              ...settingsDraft.detailsPanelFields,
                              field as keyof typeof PANEL_COPY,
                            ]
                          : settingsDraft.detailsPanelFields.filter(
                              (candidate) => candidate !== field,
                            );
                        setSettingsDraft({
                          ...settingsDraft,
                          detailsPanelFields: next,
                        });
                      }}
                    />
                    {copy[message]}
                  </label>
                ))}
              </fieldset>
              <button
                className="primary-button"
                type="button"
                onClick={() => void savePreferences()}
              >
                {copy.saveSettings}
              </button>
            </div>
          )}
        </details>
      </div>

      <div className="purchase-row-layout">
        <div className="purchase-row-table-wrap">
          <table className="purchase-row-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                {visibleColumns.map(({ field }) => (
                  <th scope="col" key={field}>
                    {copy[FIELD_COPY[field]]}
                  </th>
                ))}
                <th scope="col">{copy.inventoryUnits}</th>
              </tr>
            </thead>
            <tbody>
              {draft.rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.ordinal}</th>
                  {visibleColumns.map(({ field }) => (
                    <td key={field}>{committedValue(field, row, copy)}</td>
                  ))}
                  <td>
                    <bdi>{row.inventoryUnitQuantity}</bdi>{" "}
                    {row.inventoryUnitName}
                  </td>
                </tr>
              ))}
              <tr className="purchase-entry-row" data-entry-epoch={entryEpoch}>
                <th scope="row">{draft.rows.length + 1}</th>
                {visibleColumns.map(({ field }) => (
                  <td key={field}>{renderEditor(field)}</td>
                ))}
                <td>
                  {product === null
                    ? "—"
                    : previewInventoryUnits(product, unitKey, quantity)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <aside
          className="purchase-item-panel"
          aria-labelledby="purchase-item-panel-title"
        >
          <h3 id="purchase-item-panel-title">{copy.detailsPanel}</h3>
          {product === null ? (
            <p>{copy.itemPanelEmpty}</p>
          ) : (
            <>
              <strong>{product.displayName}</strong>
              <dl>
                {preferences?.detailsPanelFields.includes("scientific-name") ? (
                  <div>
                    <dt>{copy.scientificName}</dt>
                    <dd>{product.scientificName ?? "—"}</dd>
                  </div>
                ) : null}
                {preferences?.detailsPanelFields.includes("category") ? (
                  <div>
                    <dt>{copy.category}</dt>
                    <dd>{product.category ?? "—"}</dd>
                  </div>
                ) : null}
                {preferences?.detailsPanelFields.includes("packaging") ? (
                  <div>
                    <dt>{copy.packaging}</dt>
                    <dd>{packagingText(product)}</dd>
                  </div>
                ) : null}
                {preferences?.detailsPanelFields.includes("wholesale-price") ? (
                  <div>
                    <dt>{copy.wholesalePrice}</dt>
                    <dd>
                      <bdi>{product.pricing.wholesalePriceFils ?? "—"}</bdi>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </>
          )}
        </aside>
      </div>

      <details
        className="purchase-optional-controls"
        onToggle={(event) => {
          if (event.currentTarget.open)
            queueMicrotask(() => optionalUnitRef.current?.focus());
        }}
      >
        <summary>{copy.optionalControls}</summary>
        <div>
          <label>
            {copy.rowUnit}
            <select
              ref={optionalUnitRef}
              value={unitKey}
              disabled={product === null}
              onChange={(event) => setUnitKey(event.target.value)}
            >
              {unitOptions(product)}
            </select>
          </label>
          {product?.pricing.method === "by-percentage" ? (
            <label>
              {copy.rowMargin}
              <input
                value={marginPercentage}
                onChange={(event) => {
                  setMarginPercentage(event.target.value);
                  setRetailPriceFils(
                    calculatePurchaseRetailPreview(
                      costFils,
                      event.target.value,
                      product.pricing.method === "by-percentage"
                        ? product.pricing.rounding
                        : "off",
                    ),
                  );
                }}
              />
            </label>
          ) : null}
          <label>
            {copy.lot}
            <input
              maxLength={120}
              value={lotNumber}
              onChange={(event) => setLotNumber(event.target.value)}
            />
          </label>
          <label>
            {copy.notes}
            <textarea
              maxLength={1000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>
      </details>

      {error === null ? null : (
        <p className="form-error" role="alert" aria-live="assertive">
          {error}
        </p>
      )}
      {message === null ? null : (
        <p className="form-success" role="status" aria-live="polite">
          {message}
        </p>
      )}

      <PurchaseReview draft={draft} />
      {quickCreateValue === null ? null : (
        <QuickProductDialog
          baseUrl={baseUrl}
          initialValue={quickCreateValue}
          onCancel={() => {
            setQuickCreateValue(null);
            focusField("item");
          }}
          onSuccess={(created) => {
            setQuickCreateValue(null);
            attachProduct(created, true);
          }}
        />
      )}
    </section>
  );

  function renderEditor(field: PurchaseEntryColumnField): React.JSX.Element {
    const common = {
      "data-enter-field": field,
      disabled: busy,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) =>
        onFieldEnter(field, event),
      ref: (element: HTMLElement | null) => {
        fieldRefs.current[field] = element;
      },
    };
    switch (field) {
      case "item":
        return (
          <input
            {...common}
            aria-label={copy.itemBarcode}
            autoComplete="off"
            value={itemQuery}
            onChange={(event) => {
              setItemQuery(event.target.value);
              setProduct(null);
            }}
          />
        );
      case "quantity":
        return (
          <input
            {...common}
            aria-label={copy.rowQuantity}
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        );
      case "cost":
        return (
          <input
            {...common}
            aria-label={copy.rowCost}
            inputMode="numeric"
            value={costFils}
            onChange={(event) => {
              setCostFils(event.target.value);
              if (product?.pricing.method === "by-percentage")
                setRetailPriceFils(
                  calculatePurchaseRetailPreview(
                    event.target.value,
                    marginPercentage,
                    product.pricing.rounding,
                  ),
                );
            }}
          />
        );
      case "selling-price": {
        const locked = product?.pricing.method === "by-percentage";
        return (
          <input
            {...common}
            aria-label={copy.sellingPrice}
            inputMode="numeric"
            readOnly={locked}
            tabIndex={locked ? -1 : 0}
            title={locked ? copy.lockedByPercentage : undefined}
            value={retailPriceFils}
            onChange={(event) => setRetailPriceFils(event.target.value)}
          />
        );
      }
      case "expiry":
        return (
          <input
            {...common}
            aria-label={copy.rowExpiry}
            type="date"
            value={expiryDate}
            onChange={(event) => setExpiryDate(event.target.value)}
          />
        );
    }
  }
}

export function purchaseEntryProgression(
  preferences: PurchaseEntryPreferences | null,
  product: Product | null,
): PurchaseEntryColumnField[] {
  const columns = preferences?.columns ?? [
    { field: "item" as const, visible: true },
    { field: "quantity" as const, visible: true },
    { field: "cost" as const, visible: true },
    { field: "selling-price" as const, visible: true },
    { field: "expiry" as const, visible: true },
  ];
  return columns
    .filter(({ visible }) => visible)
    .map(({ field }) => field)
    .filter(
      (field) =>
        field !== "selling-price" ||
        product === null ||
        PRODUCT_PRICING_FIELD_EDITABILITY[product.pricing.method]
          .retailPrice === "editable",
    );
}

function QuickProductDialog({
  baseUrl,
  initialValue,
  onCancel,
  onSuccess,
}: {
  readonly baseUrl: string;
  readonly initialValue: string;
  readonly onCancel: () => void;
  readonly onSuccess: (product: Product) => void;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const dialogRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const cancelOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCancel();
    };
    window.addEventListener("keydown", cancelOnEscape, true);
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelector<HTMLElement>(
      "input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled])",
    );
    focusable?.focus();
    return () => window.removeEventListener("keydown", cancelOnEscape, true);
  }, [onCancel]);
  return (
    <div
      className="dialog-backdrop purchase-product-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-product-title"
      ref={dialogRef}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...(dialogRef.current?.querySelectorAll<HTMLElement>(
            "input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary",
          ) ?? []),
        ];
        if (controls.length === 0) return;
        const current = controls.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? controls[(current - 1 + controls.length) % controls.length]
          : controls[(current + 1) % controls.length];
        event.preventDefault();
        next?.focus();
      }}
    >
      <div className="purchase-product-dialog-card">
        <h2 id="quick-product-title">{copy.createProductTitle}</h2>
        <p>{copy.quickCreateHint}</p>
        <ProductForm
          baseUrl={baseUrl}
          {...(looksLikeBarcode(initialValue)
            ? { initialBarcode: initialValue }
            : {})}
          onCancel={onCancel}
          onSuccess={onSuccess}
        />
      </div>
    </div>
  );
}

function PurchaseReview({
  draft,
}: {
  readonly draft: PurchaseDraftDetail;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  return (
    <section
      className="purchase-review"
      aria-labelledby="purchase-review-title"
    >
      <h3 id="purchase-review-title">{copy.review}</h3>
      <dl>
        <div>
          <dt>{copy.gross}</dt>
          <dd>
            <bdi>{draft.review.grossFils}</bdi> {copy.fils}
          </dd>
        </div>
        <div>
          <dt>{copy.discount}</dt>
          <dd>
            <bdi>{draft.review.allowanceFils}</bdi> {copy.fils}
          </dd>
        </div>
        <div>
          <dt>{copy.net}</dt>
          <dd>
            <bdi>{draft.review.netFils}</bdi> {copy.fils}
          </dd>
        </div>
        <div>
          <dt>
            {draft.review.settlementEffect.context === "cash"
              ? copy.tenderEffect
              : copy.payableEffect}
          </dt>
          <dd>
            <bdi>
              {draft.review.settlementEffect.context === "cash"
                ? draft.review.settlementEffect.tenderFils
                : draft.review.settlementEffect.payableFils}
            </bdi>{" "}
            {copy.fils}
          </dd>
        </div>
      </dl>
      <div className="purchase-review-batches">
        <strong>{copy.batches}</strong>
        {draft.review.batches.length === 0 ? (
          <span>—</span>
        ) : (
          <ul>
            {draft.review.batches.map((batch, index) => (
              <li key={`${batch.itemDisplayName}-${index}`}>
                {batch.itemDisplayName} · <bdi>{batch.lotNumber ?? "—"}</bdi> ·{" "}
                <bdi>{batch.expiryDate ?? "—"}</bdi>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="purchase-review-warnings">
        <strong>{copy.warnings}</strong>
        <ul>
          {draft.review.warnings.map((warning) => (
            <li key={warning}>
              {warning === "missing-expiry"
                ? copy.missingExpiryWarning
                : warning === "missing-lot"
                  ? copy.missingLotWarning
                  : copy.postingUnavailableWarning}
            </li>
          ))}
        </ul>
      </div>
      <div className="purchase-review-actions">
        <button
          type="button"
          className="primary-button"
          disabled
          aria-describedby="purchase-post-pending"
        >
          {copy.post}
        </button>
        <p id="purchase-post-pending">{copy.postPending}</p>
      </div>
    </section>
  );
}

function committedValue(
  field: PurchaseEntryColumnField,
  row: PurchaseDraftDetail["rows"][number],
  copy: (typeof purchasingMessages)["en"] | (typeof purchasingMessages)["ar"],
): React.ReactNode {
  switch (field) {
    case "item":
      return row.itemDisplayName;
    case "quantity":
      return <bdi>{row.enteredQuantity}</bdi>;
    case "cost":
      return <bdi>{row.costFils}</bdi>;
    case "selling-price":
      return <bdi>{row.retailPriceFils}</bdi>;
    case "expiry":
      return <bdi>{row.expiryDate ?? "—"}</bdi>;
    default:
      return copy.rowError;
  }
}

function unitToKey(
  unit: Product["packaging"]["defaultUnits"]["purchase"],
): string {
  return unit.kind === "inventory-unit"
    ? "inventory-unit"
    : `package:${unit.packageUnitName}`;
}
function keyToUnit(
  key: string,
):
  | { kind: "inventory-unit" }
  | { kind: "package-unit"; packageUnitName: string } {
  return key === "inventory-unit"
    ? { kind: "inventory-unit" }
    : { kind: "package-unit", packageUnitName: key.slice("package:".length) };
}
function unitOptions(product: Product | null): React.JSX.Element[] {
  if (product === null)
    return [
      <option key="none" value="inventory-unit">
        —
      </option>,
    ];
  return [
    <option key="inventory" value="inventory-unit">
      {product.packaging.inventoryUnitName}
    </option>,
    ...product.packaging.packageUnits.map((unit) => (
      <option key={unit.name} value={`package:${unit.name}`}>
        {unit.name}
      </option>
    )),
  ];
}
function previewInventoryUnits(
  product: Product,
  unitKey: string,
  quantity: string,
): string {
  if (!isPositiveInteger(quantity)) return "—";
  const ratio =
    unitKey === "inventory-unit"
      ? 1n
      : BigInt(
          product.packaging.packageUnits.find(
            (unit) => unit.name === unitKey.slice("package:".length),
          )?.baseUnitsPerPackage ?? "0",
        );
  return `${(BigInt(quantity) * ratio).toString()} ${product.packaging.inventoryUnitName}`;
}
function packagingText(product: Product): string {
  const packages = product.packaging.packageUnits.map(
    (unit) => `${unit.name} × ${unit.baseUnitsPerPackage}`,
  );
  return [product.packaging.inventoryUnitName, ...packages].join(" · ");
}
function looksLikeBarcode(value: string): boolean {
  return /^(?:[0-9]{4,}|BRV-[0-9]{4,})$/u.test(value);
}
function isPositiveInteger(value: string): boolean {
  return /^[1-9][0-9]*$/u.test(value);
}
function isUnsignedInteger(value: string): boolean {
  return /^(?:0|[1-9][0-9]*)$/u.test(value);
}
export function calculatePurchaseRetailPreview(
  cost: string,
  margin: string,
  rounding: "nearest-1000-iqd" | "nearest-250-iqd" | "nearest-500-iqd" | "off",
): string {
  if (
    !isUnsignedInteger(cost) ||
    !/^(?:0|[1-9][0-9]?)(?:\.[0-9]{1,6})?$/u.test(margin)
  )
    return "0";
  const [whole = "0", fraction = ""] = margin.split(".");
  const scaled = BigInt(`${whole}${fraction.padEnd(6, "0")}`);
  const hundred = 100_000_000n;
  if (scaled >= hundred) return "0";
  const multiple =
    rounding === "off"
      ? 1n
      : rounding === "nearest-250-iqd"
        ? 250_000n
        : rounding === "nearest-500-iqd"
          ? 500_000n
          : 1_000_000n;
  const numerator = BigInt(cost) * hundred;
  const denominator = (hundred - scaled) * multiple;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return (
    (quotient + (remainder * 2n >= denominator ? 1n : 0n)) *
    multiple
  ).toString();
}
