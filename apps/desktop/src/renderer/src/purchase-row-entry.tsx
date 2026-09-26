import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  PRODUCT_PRICING_FIELD_EDITABILITY,
  type Product,
  type ProductSearchResult,
  type PurchaseDraftDetail,
  type PurchaseEntryColumnField,
  type PurchaseEntryPreferences,
  type PurchasingDenial,
} from "@breev/contracts/local-rest";
import { requestProduct, searchProducts } from "./catalog-api";
import { formatFilsToIqd } from "./product-record";
import { ProductForm } from "./product-form";
import type { PurchaseItemSelection } from "./purchase-item-details";
import {
  commitPurchaseDraftRow,
  discardPurchaseDraftRow,
  purchasingCommandAttempt,
  PurchasingApiDenied,
  requestPurchaseEntryPreferences,
  updatePurchaseDraftRow,
  updatePurchaseEntryPreferences,
  type PurchasingCommandAttempt,
} from "./purchasing-api";
import { purchasingMessages } from "./purchasing-messages";
import { usePreferences } from "./preferences-provider";

interface PurchaseRowEntryProps {
  readonly baseUrl: string;
  readonly draft: PurchaseDraftDetail;
  readonly onDraftChanged: (draft: PurchaseDraftDetail) => void;
  readonly onItemSelectionChanged: (
    selection: PurchaseItemSelection | null,
  ) => void;
  readonly onPost: () => Promise<void>;
  readonly postDenial: PurchasingDenial | null;
  readonly posting: boolean;
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
  onItemSelectionChanged,
  onPost,
  postDenial,
  posting,
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
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState("1");
  const [editCostFils, setEditCostFils] = useState("0");
  const [editRetailPriceFils, setEditRetailPriceFils] = useState("0");
  const [editMarginPercentage, setEditMarginPercentage] = useState("0");
  const [editExpiryDate, setEditExpiryDate] = useState("");
  const [editLotNumber, setEditLotNumber] = useState("");
  const [editNotes, setEditNotes] = useState("");
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

  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [selectedRowProduct, setSelectedRowProduct] = useState<Product | null>(
    null,
  );
  const [masterCardProduct, setMasterCardProduct] = useState<Product | null>(
    null,
  );
  const productCache = useRef<Map<string, Product>>(new Map());
  const masterCardRowIdRef = useRef<string | null>(null);
  const activeSelectionRequestId = useRef<string | null>(null);

  const [suggestions, setSuggestions] = useState<ProductSearchResult[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimer = useRef<number | null>(null);
  const comboboxRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const latestQueryRef = useRef("");

  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [saveSettingsSuccess, setSaveSettingsSuccess] = useState(false);
  const [isOptionalOpen, setIsOptionalOpen] = useState(false);
  const [isEditOptionalOpen, setIsEditOptionalOpen] = useState(false);
  const [optionalOpensUpward, setOptionalOpensUpward] = useState(false);
  const [editOptionalOpensUpward, setEditOptionalOpensUpward] = useState(false);
  const settingsRef = useRef<HTMLDetailsElement>(null);
  const optionalRef = useRef<HTMLDetailsElement>(null);
  const editOptionalRef = useRef<HTMLDetailsElement>(null);
  const saveSuccessTimerRef = useRef<number | null>(null);

  const highlightedProduct =
    isSuggestionsOpen && highlightedIndex >= 0 && suggestions[highlightedIndex]
      ? suggestions[highlightedIndex].product
      : null;

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
    if (highlightedIndex >= 0 && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({
        block: "nearest",
      });
    }
  }, [highlightedIndex]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (
        comboboxRef.current &&
        !comboboxRef.current.contains(event.target as Node)
      ) {
        setIsSuggestionsOpen(false);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleSettingsOutside(event: MouseEvent): void {
      const target = event.target as Node;
      if (settingsRef.current?.open && !settingsRef.current.contains(target)) {
        settingsRef.current.open = false;
      }
      if (optionalRef.current?.open && !optionalRef.current.contains(target)) {
        optionalRef.current.open = false;
        setIsOptionalOpen(false);
      }
      if (
        editOptionalRef.current?.open &&
        !editOptionalRef.current.contains(target)
      ) {
        editOptionalRef.current.open = false;
        setIsEditOptionalOpen(false);
      }
    }
    function handleSettingsKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        if (settingsRef.current?.open) {
          settingsRef.current.open = false;
          settingsRef.current.querySelector("summary")?.focus();
        }
        if (optionalRef.current?.open) {
          optionalRef.current.open = false;
          setIsOptionalOpen(false);
          optionalRef.current.querySelector("summary")?.focus();
        }
        if (editOptionalRef.current?.open) {
          editOptionalRef.current.open = false;
          setIsEditOptionalOpen(false);
          editOptionalRef.current.querySelector("summary")?.focus();
        }
      }
    }
    document.addEventListener("mousedown", handleSettingsOutside);
    document.addEventListener("keydown", handleSettingsKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleSettingsOutside);
      document.removeEventListener("keydown", handleSettingsKeyDown);
      if (saveSuccessTimerRef.current !== null) {
        window.clearTimeout(saveSuccessTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimer.current !== null) {
        window.clearTimeout(searchTimer.current);
      }
    };
  }, []);

  const displayedProduct = determineDisplayedProduct({
    entryRowProduct: product,
    highlightedProduct,
    isRowSelected: selectedRowId !== null,
    selectedRowProduct,
  });

  // The item-details panel is rendered by the screen, in the column the shell
  // reserves for it, so the row publishes its current item upward instead of
  // drawing a panel of its own beyond the right edge of the row table. The
  // cleanup empties the panel when the row entry leaves, so a posted or
  // discarded invoice never leaves a wholesale price on screen.
  useEffect(() => {
    const activeRow =
      selectedRowId !== null
        ? draft.rows.find((r) => r.id === selectedRowId)
        : null;
    const activeExpiry =
      activeRow?.expiryDate ??
      (displayedProduct?.id === product?.id ? expiryDate : null);
    const activeQty =
      activeRow?.enteredQuantity ??
      (displayedProduct?.id === product?.id ? quantity : null);
    const activeUnit =
      activeRow !== null && activeRow !== undefined
        ? activeRow.unit.kind === "inventory-unit"
          ? activeRow.inventoryUnitName
          : activeRow.unit.packageUnitName
        : unitKey === "inventory-unit"
          ? (product?.packaging.inventoryUnitName ?? null)
          : keyToUnit(unitKey).kind === "package-unit"
            ? (keyToUnit(unitKey) as { packageUnitName: string })
                .packageUnitName
            : null;
    const activeBaseUnits = activeRow?.inventoryUnitQuantity ?? null;

    onItemSelectionChanged(
      displayedProduct === null
        ? null
        : {
            fields: preferences?.detailsPanelFields ?? [],
            product: displayedProduct,
            expiryDate: activeExpiry || null,
            rowQuantity: activeQty || null,
            unit: activeUnit,
            baseUnits: activeBaseUnits,
          },
    );
    return () => onItemSelectionChanged(null);
  }, [
    displayedProduct,
    draft.rows,
    expiryDate,
    onItemSelectionChanged,
    preferences,
    product,
    quantity,
    selectedRowId,
    unitKey,
  ]);

  useEffect(() => {
    if (
      selectedRowId !== null &&
      !draft.rows.some((row) => row.id === selectedRowId)
    ) {
      setSelectedRowId(null);
      setSelectedRowProduct(null);
    }
  }, [draft.rows, selectedRowId]);

  useEffect(() => {
    if (initialFocusDone.current) return;
    const first =
      preferences === null
        ? "item"
        : (purchaseEntryProgression(preferences, null)[0] ?? "item");
    const timer = window.setTimeout(() => {
      fieldRefs.current[first]?.focus();
      if (preferences !== null) {
        initialFocusDone.current = true;
      }
    }, 0);
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

  useEffect(() => {
    const fieldError = postDenial?.fieldErrors[0];
    if (fieldError === undefined) return;
    const rowIndex = fieldError.path[0] === "rows" ? fieldError.path[1] : null;
    const field = fieldError.path[0] === "rows" ? fieldError.path[2] : null;
    if (typeof rowIndex !== "number" || typeof field !== "string") return;
    const target = document.querySelector<HTMLElement>(
      `[data-post-row="${rowIndex}"][data-post-field="${field}"]`,
    );
    target?.focus();
  }, [postDenial]);

  function focusField(field: PurchaseEntryColumnField): void {
    focusSequence.current += 1;
    setFocusRequest({ field, sequence: focusSequence.current });
  }

  function closeSuggestions(): void {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    setIsSuggestionsOpen(false);
    setSuggestions([]);
    setHighlightedIndex(-1);
    setIsSearching(false);
  }

  function attachProduct(next: Product, returnToItem = false): void {
    closeSuggestions();
    productCache.current.set(next.id, next);
    setProduct(next);
    setItemQuery(next.displayName);
    latestQueryRef.current = next.displayName;
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

  const handleQuickCreateCancel = useCallback(() => {
    setQuickCreateValue(null);
    focusField("item");
  }, []);

  const handleQuickCreateSuccess = useCallback((created: Product) => {
    productCache.current.set(created.id, created);
    setQuickCreateValue(null);
    attachProduct(created, true);
  }, []);

  const getOrFetchProduct = useCallback(
    async (itemId: string): Promise<Product> => {
      const cached = productCache.current.get(itemId);
      if (cached !== undefined) {
        return cached;
      }
      const fetched = await requestProduct(baseUrl, itemId);
      productCache.current.set(itemId, fetched);
      return fetched;
    },
    [baseUrl],
  );

  const selectRow = useCallback(
    async (row: PurchaseDraftDetail["rows"][number]): Promise<void> => {
      setSelectedRowId(row.id);
      activeSelectionRequestId.current = row.id;
      const cached = productCache.current.get(row.itemId);
      if (cached !== undefined) {
        setSelectedRowProduct(cached);
        return;
      }
      try {
        const fetched = await getOrFetchProduct(row.itemId);
        if (activeSelectionRequestId.current === row.id) {
          setSelectedRowProduct(fetched);
        }
      } catch {
        if (activeSelectionRequestId.current === row.id) {
          setSelectedRowProduct(null);
        }
      }
    },
    [getOrFetchProduct],
  );

  const openMasterCard = useCallback(
    async (row: PurchaseDraftDetail["rows"][number]): Promise<void> => {
      masterCardRowIdRef.current = row.id;
      setBusy(true);
      setError(null);
      try {
        const targetProduct = await getOrFetchProduct(row.itemId);
        setMasterCardProduct(targetProduct);
      } catch {
        setError(copy.apiUnavailable);
      } finally {
        setBusy(false);
      }
    },
    [copy.apiUnavailable, getOrFetchProduct],
  );

  const handleMasterCardCancel = useCallback(() => {
    const rowId = masterCardRowIdRef.current;
    setMasterCardProduct(null);
    masterCardRowIdRef.current = null;
    if (rowId !== null) {
      queueMicrotask(() => {
        document
          .querySelector<HTMLElement>(
            `.purchase-row-table tbody tr[data-row-id="${rowId}"]`,
          )
          ?.focus();
      });
    }
  }, []);

  const handleMasterCardSuccess = useCallback(
    (updated: Product) => {
      const rowId = masterCardRowIdRef.current;
      productCache.current.set(updated.id, updated);
      setSelectedRowProduct((current) =>
        current?.id === updated.id ? updated : current,
      );
      if (product?.id === updated.id) {
        setProduct(updated);
        setItemQuery(updated.displayName);
      }
      const { hasChanges, rows: updatedRows } = updateDraftRowProductAttributes(
        draft.rows,
        updated,
      );
      if (hasChanges) {
        onDraftChanged({
          ...draft,
          rows: updatedRows,
        });
      }
      setMasterCardProduct(null);
      masterCardRowIdRef.current = null;
      if (rowId !== null) {
        queueMicrotask(() => {
          document
            .querySelector<HTMLElement>(
              `.purchase-row-table tbody tr[data-row-id="${rowId}"]`,
            )
            ?.focus();
        });
      }
    },
    [draft, onDraftChanged, product],
  );

  function handleRowKeyDown(
    event: React.KeyboardEvent<HTMLTableRowElement>,
    row: PurchaseDraftDetail["rows"][number],
    rowIndex: number,
  ): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void openMasterCard(row);
      return;
    }
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      void selectRow(row);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextRow = draft.rows[rowIndex + 1];
      if (nextRow !== undefined) {
        const nextElement = document.querySelector<HTMLTableRowElement>(
          `.purchase-row-table tbody tr[data-row-id="${nextRow.id}"]`,
        );
        nextElement?.focus();
        void selectRow(nextRow);
      } else {
        const first =
          preferences === null
            ? "item"
            : (purchaseEntryProgression(preferences, null)[0] ?? "item");
        fieldRefs.current[first]?.focus();
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rowIndex > 0) {
        const prevRow = draft.rows[rowIndex - 1];
        if (prevRow !== undefined) {
          const prevElement = document.querySelector<HTMLTableRowElement>(
            `.purchase-row-table tbody tr[data-row-id="${prevRow.id}"]`,
          );
          prevElement?.focus();
          void selectRow(prevRow);
        }
      }
      return;
    }
  }

  const scheduleSearch = useCallback(
    (query: string) => {
      if (searchTimer.current !== null) {
        window.clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        setSuggestions([]);
        setIsSuggestionsOpen(false);
        setHighlightedIndex(-1);
        setIsSearching(false);
        return;
      }
      if (product !== null && trimmed === product.displayName) {
        setIsSuggestionsOpen(false);
        setHighlightedIndex(-1);
        setIsSearching(false);
        return;
      }
      setIsSearching(true);
      searchTimer.current = window.setTimeout(async () => {
        try {
          const result = await searchProducts(baseUrl, {
            limit: "15",
            query: trimmed,
          });
          for (const item of result.results) {
            productCache.current.set(item.product.id, item.product);
          }
          if (latestQueryRef.current.trim() === trimmed) {
            setSuggestions(result.results);
            setIsSuggestionsOpen(true);
            setHighlightedIndex(-1);
          }
        } catch {
          // Keep current state on transient failure
        } finally {
          if (latestQueryRef.current.trim() === trimmed) {
            setIsSearching(false);
          }
        }
      }, 180);
    },
    [baseUrl, product],
  );

  function handleItemChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    latestQueryRef.current = value;
    setItemQuery(value);
    setProduct(null);
    scheduleSearch(value);
  }

  function handleItemKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      if (suggestions.length > 0) {
        event.preventDefault();
        if (!isSuggestionsOpen) {
          setIsSuggestionsOpen(true);
          setHighlightedIndex(0);
        } else {
          setHighlightedIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0,
          );
        }
      }
      return;
    }

    if (event.key === "ArrowUp") {
      if (isSuggestionsOpen && suggestions.length > 0) {
        event.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1,
        );
      }
      return;
    }

    if (event.key === "Escape") {
      if (isSuggestionsOpen) {
        event.preventDefault();
        setIsSuggestionsOpen(false);
        setHighlightedIndex(-1);
      }
      return;
    }

    if (event.key === "Tab") {
      if (isSuggestionsOpen) {
        setIsSuggestionsOpen(false);
        setHighlightedIndex(-1);
      }
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;

      if (
        isSuggestionsOpen &&
        highlightedIndex >= 0 &&
        suggestions[highlightedIndex]
      ) {
        const chosen = suggestions[highlightedIndex]!.product;
        attachProduct(chosen);
        focusNext("item", chosen);
        return;
      }

      if (isSuggestionsOpen) {
        const query = itemQuery.trim();
        const exactBarcode = suggestions.find(
          ({ matchedBarcode }) => matchedBarcode?.value === query,
        );
        if (exactBarcode) {
          attachProduct(exactBarcode.product);
          focusNext("item", exactBarcode.product);
          return;
        }
        if (suggestions.length === 1 && suggestions[0]) {
          const single = suggestions[0].product;
          attachProduct(single);
          focusNext("item", single);
          return;
        }
        if (suggestions.length > 1) {
          setHighlightedIndex(0);
          return;
        }
        closeSuggestions();
        setQuickCreateValue(query);
        return;
      }

      void resolveItemAndAdvance();
      return;
    }
  }

  async function resolveItemAndAdvance(): Promise<void> {
    const query = itemQuery.trim();
    if (product !== null && query === product.displayName) {
      closeSuggestions();
      focusNext("item", product);
      return;
    }
    if (query === "") {
      setError(copy.itemRequired);
      focusField("item");
      return;
    }
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    setBusy(true);
    try {
      const result = await searchProducts(baseUrl, { limit: "20", query });
      for (const item of result.results) {
        productCache.current.set(item.product.id, item.product);
      }
      const exactBarcode = result.results.find(
        ({ matchedBarcode }) => matchedBarcode?.value === query,
      );
      if (exactBarcode) {
        attachProduct(exactBarcode.product);
        setBusy(false);
        focusNext("item", exactBarcode.product);
        return;
      }
      if (result.results.length === 1 && result.results[0]) {
        const single = result.results[0].product;
        attachProduct(single);
        setBusy(false);
        focusNext("item", single);
        return;
      }
      if (result.results.length > 1) {
        setSuggestions(result.results);
        setIsSuggestionsOpen(true);
        setHighlightedIndex(0);
        setBusy(false);
        return;
      }
      closeSuggestions();
      setQuickCreateValue(query);
      setBusy(false);
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
    if (optionalRef.current) optionalRef.current.open = false;
    setIsOptionalOpen(false);
  }

  function startEditingRow(row: PurchaseDraftDetail["rows"][number]): void {
    setEditingRowId(row.id);
    setEditQuantity(row.enteredQuantity);
    setEditCostFils(row.costFils);
    setEditRetailPriceFils(row.retailPriceFils);
    setEditMarginPercentage(row.marginPercentage ?? "0");
    setEditExpiryDate(row.expiryDate ?? "");
    setEditLotNumber(row.lotNumber ?? "");
    setEditNotes(row.notes ?? "");
    setError(null);
  }

  function cancelEditingRow(): void {
    setEditingRowId(null);
    if (editOptionalRef.current) editOptionalRef.current.open = false;
    setIsEditOptionalOpen(false);
  }

  async function saveEditedRow(
    row: PurchaseDraftDetail["rows"][number],
  ): Promise<void> {
    if (!isPositiveInteger(editQuantity)) {
      setError(copy.quantityInvalid);
      return;
    }
    if (!isUnsignedInteger(editCostFils)) {
      setError(copy.costInvalid);
      return;
    }
    const pricing =
      row.pricingMethod === "by-price"
        ? ({
            method: "by-price",
            retailPriceFils: editRetailPriceFils,
          } as const)
        : ({
            marginPercentage: editMarginPercentage,
            method: "by-percentage",
          } as const);
    const body = {
      costFils: editCostFils,
      enteredQuantity: editQuantity,
      expectedVersion: draft.version,
      expiryDate: editExpiryDate === "" ? null : editExpiryDate,
      itemId: row.itemId,
      lotNumber: editLotNumber.trim() === "" ? null : editLotNumber.trim(),
      notes: editNotes.trim() === "" ? null : editNotes.trim(),
      pricing,
      unit: row.unit,
    };
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await updatePurchaseDraftRow(baseUrl, draft.id, row.id, {
        ...body,
        idempotencyKey: crypto.randomUUID(),
      });
      onDraftChanged(result.draft);
      setEditingRowId(null);
      if (editOptionalRef.current) editOptionalRef.current.open = false;
      setIsEditOptionalOpen(false);
      setMessage(copy.rowUpdated);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof PurchasingApiDenied
          ? copy.rowError
          : copy.apiUnavailable,
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteRow(
    row: PurchaseDraftDetail["rows"][number],
  ): Promise<void> {
    if (!window.confirm(copy.confirmDeleteRow)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await discardPurchaseDraftRow(baseUrl, draft.id, row.id, {
        expectedVersion: draft.version,
        idempotencyKey: crypto.randomUUID(),
      });
      onDraftChanged(result);
      if (editingRowId === row.id) setEditingRowId(null);
      if (selectedRowId === row.id) {
        setSelectedRowId(null);
        setSelectedRowProduct(null);
      }
      setMessage(copy.rowDeleted);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof PurchasingApiDenied
          ? copy.rowError
          : copy.apiUnavailable,
      );
    } finally {
      setBusy(false);
    }
  }

  function handleEditKeyDown(
    row: PurchaseDraftDetail["rows"][number],
    event: KeyboardEvent<HTMLElement>,
  ): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveEditedRow(row);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEditingRow();
    }
  }

  async function savePreferences(): Promise<void> {
    if (settingsDraft === null || isSavingSettings) return;
    setIsSavingSettings(true);
    setSaveSettingsSuccess(false);
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
      setSaveSettingsSuccess(true);
      if (saveSuccessTimerRef.current !== null) {
        window.clearTimeout(saveSuccessTimerRef.current);
      }
      saveSuccessTimerRef.current = window.setTimeout(() => {
        if (settingsRef.current) {
          settingsRef.current.open = false;
        }
        setSaveSettingsSuccess(false);
        saveSuccessTimerRef.current = null;
      }, 750);
    } catch {
      setError(copy.apiUnavailable);
    } finally {
      setIsSavingSettings(false);
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

  const hasActiveOptionalFields =
    lotNumber.trim() !== "" ||
    notes.trim() !== "" ||
    unitKey !== "inventory-unit" ||
    (product?.pricing.method === "by-percentage" &&
      marginPercentage.trim() !== "" &&
      marginPercentage.trim() !== "0");

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
        <details ref={settingsRef} className="purchase-entry-settings">
          <summary>{copy.columnSettings}</summary>
          {settingsDraft === null ? null : (
            <div className="purchase-entry-settings-body">
              <div className="purchase-settings-header">
                <strong>{copy.columnSettings}</strong>
                <button
                  type="button"
                  className="quiet-button purchase-settings-close"
                  aria-label={copy.closeSettings}
                  onClick={() => {
                    if (settingsRef.current) settingsRef.current.open = false;
                  }}
                >
                  ✕
                </button>
              </div>
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
              <div className="purchase-settings-actions">
                <button
                  className={`primary-button purchase-settings-save-btn ${saveSettingsSuccess ? "is-success" : ""}`}
                  type="button"
                  disabled={isSavingSettings}
                  aria-label={copy.saveSettings}
                  onClick={() => void savePreferences()}
                >
                  {isSavingSettings ? (
                    <>
                      <span
                        className="purchase-settings-spinner"
                        aria-hidden="true"
                      />
                      <span>{copy.savingSettings}</span>
                    </>
                  ) : saveSettingsSuccess ? (
                    <>
                      <span aria-hidden="true">✓</span>
                      <span>{copy.settingsSaved}</span>
                    </>
                  ) : (
                    <span>{copy.saveSettings}</span>
                  )}
                </button>
              </div>
            </div>
          )}
        </details>
      </div>

      <div
        className={`purchase-row-table-wrap ${
          isSuggestionsOpen ? "has-suggestions-open" : ""
        } ${isOptionalOpen || isEditOptionalOpen ? "has-optional-open" : ""}`}
      >
        <table className="purchase-row-table">
          <thead>
            <tr>
              <th scope="col" data-column-field="ordinal">
                #
              </th>
              {visibleColumns.map(({ field }) => (
                <th scope="col" key={field} data-column-field={field}>
                  {copy[FIELD_COPY[field]]}
                </th>
              ))}
              <th scope="col" data-column-field="inventory-units">
                {copy.inventoryUnits}
              </th>
              <th scope="col" data-column-field="actions">
                {copy.rowActions}
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, rowIndex) => {
              const isEditing = editingRowId === row.id;
              const isSelected = selectedRowId === row.id;
              return (
                <tr
                  key={row.id}
                  data-row-id={row.id}
                  data-editing={isEditing ? "true" : undefined}
                  data-selected={isSelected ? "true" : undefined}
                  tabIndex={isEditing ? undefined : 0}
                  aria-selected={isSelected}
                  onClick={(event) => {
                    if (
                      (event.target as HTMLElement).closest(
                        "button, input, select, textarea",
                      )
                    ) {
                      return;
                    }
                    void selectRow(row);
                  }}
                  onDoubleClick={(event) => {
                    if (
                      (event.target as HTMLElement).closest(
                        "button, input, select, textarea",
                      )
                    ) {
                      return;
                    }
                    void openMasterCard(row);
                  }}
                  onKeyDown={(event) => {
                    if (
                      (event.target as HTMLElement).closest(
                        "button, input, select, textarea",
                      )
                    ) {
                      return;
                    }
                    handleRowKeyDown(event, row, rowIndex);
                  }}
                  onFocus={(event) => {
                    if (event.target === event.currentTarget) {
                      void selectRow(row);
                    }
                  }}
                >
                  <th scope="row" data-column-field="ordinal">
                    {row.ordinal}
                  </th>
                  {visibleColumns.map(({ field }) => {
                    const hasPostError = isPostFieldError(
                      postDenial,
                      rowIndex,
                      POST_FIELD[field],
                    );
                    return (
                      <td
                        key={field}
                        data-column-field={field}
                        title={
                          field === "item"
                            ? `${row.itemDisplayName} (${copy.rowSelectionHint})`
                            : hasPostError
                              ? copy.editRow
                              : undefined
                        }
                        data-post-row={rowIndex}
                        data-post-field={POST_FIELD[field]}
                        data-post-error={hasPostError}
                        tabIndex={-1}
                        onClick={
                          !isEditing && hasPostError
                            ? () => startEditingRow(row)
                            : undefined
                        }
                        style={
                          !isEditing && hasPostError
                            ? { cursor: "pointer" }
                            : undefined
                        }
                      >
                        {isEditing
                          ? renderInlineEditor(row, field)
                          : committedValue(field, row, copy)}
                      </td>
                    );
                  })}
                  <td data-column-field="inventory-units">
                    {isEditing ? (
                      isPositiveInteger(editQuantity) ? (
                        <>
                          <bdi>
                            {(
                              BigInt(editQuantity) *
                              BigInt(row.baseUnitsPerEnteredUnit)
                            ).toString()}
                          </bdi>{" "}
                          {row.inventoryUnitName}
                        </>
                      ) : (
                        "—"
                      )
                    ) : (
                      <>
                        <bdi>{row.inventoryUnitQuantity}</bdi>{" "}
                        {row.inventoryUnitName}
                      </>
                    )}
                  </td>
                  <td data-column-field="actions">
                    <div className="purchase-row-actions-cell">
                      {isEditing ? (
                        <div className="purchase-row-action-icons-wrap">
                          <button
                            type="button"
                            className="purchase-action-icon-btn save"
                            disabled={busy}
                            aria-label={copy.saveRow}
                            title={copy.saveRow}
                            onClick={() => void saveEditedRow(row)}
                          >
                            <CheckIcon />
                            <span className="visually-hidden">
                              {copy.saveRow}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="purchase-action-icon-btn cancel"
                            disabled={busy}
                            aria-label={copy.cancelEdit}
                            title={copy.cancelEdit}
                            onClick={cancelEditingRow}
                          >
                            <CloseIcon />
                            <span className="visually-hidden">
                              {copy.cancelEdit}
                            </span>
                          </button>
                          <details
                            ref={editOptionalRef}
                            className={`purchase-row-optional-details ${
                              editOptionalOpensUpward ? "opens-upwards" : ""
                            }`}
                            onToggle={(event) => {
                              const isOpen = event.currentTarget.open;
                              setIsEditOptionalOpen(isOpen);
                              if (isOpen) {
                                const rect =
                                  event.currentTarget.getBoundingClientRect();
                                const spaceBelow =
                                  window.innerHeight - rect.bottom;
                                const spaceAbove = rect.top;
                                setEditOptionalOpensUpward(
                                  spaceBelow < 380 && spaceAbove > spaceBelow,
                                );
                              }
                            }}
                          >
                            <summary
                              className="purchase-action-icon-btn optional"
                              aria-label={copy.optionalControls}
                              title={copy.optionalControls}
                            >
                              <span aria-hidden="true">⚙</span>
                              {editLotNumber.trim() !== "" ||
                              editNotes.trim() !== "" ? (
                                <span
                                  className="purchase-row-action-dot"
                                  aria-hidden="true"
                                />
                              ) : null}
                            </summary>
                            <div className="purchase-optional-controls-body">
                              <div className="purchase-optional-header">
                                <div>
                                  <strong>{copy.optionalControls}</strong>
                                  <span
                                    className="purchase-optional-product-tag"
                                    title={row.itemDisplayName}
                                  >
                                    {row.itemDisplayName}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="quiet-button purchase-optional-close"
                                  aria-label={copy.closeSettings}
                                  onClick={() => {
                                    if (editOptionalRef.current) {
                                      editOptionalRef.current.open = false;
                                    }
                                    setIsEditOptionalOpen(false);
                                  }}
                                >
                                  ✕
                                </button>
                              </div>
                              <div className="purchase-optional-fields">
                                <label>
                                  <span className="purchase-optional-label-text">
                                    {copy.rowUnit}
                                  </span>
                                  <input
                                    readOnly
                                    disabled
                                    value={row.inventoryUnitName}
                                    className="is-disabled"
                                  />
                                </label>
                                <label>
                                  <span className="purchase-optional-label-text">
                                    {copy.lot}
                                  </span>
                                  <input
                                    maxLength={120}
                                    value={editLotNumber}
                                    onChange={(e) =>
                                      setEditLotNumber(e.target.value)
                                    }
                                  />
                                </label>
                                <label className="purchase-optional-notes-field">
                                  <span className="purchase-optional-label-text">
                                    {copy.notes}
                                  </span>
                                  <textarea
                                    maxLength={1000}
                                    rows={3}
                                    value={editNotes}
                                    onChange={(e) =>
                                      setEditNotes(e.target.value)
                                    }
                                  />
                                </label>
                              </div>
                              <div className="purchase-optional-footer">
                                <button
                                  type="button"
                                  className="primary-button purchase-optional-done-btn"
                                  onClick={() => {
                                    if (editOptionalRef.current) {
                                      editOptionalRef.current.open = false;
                                    }
                                    setIsEditOptionalOpen(false);
                                  }}
                                >
                                  {copy.done}
                                </button>
                              </div>
                            </div>
                          </details>
                        </div>
                      ) : (
                        <div className="purchase-row-action-icons-wrap">
                          <button
                            type="button"
                            className="purchase-action-icon-btn id-card"
                            disabled={busy || posting}
                            aria-label={copy.itemCard}
                            title={copy.itemCard}
                            onClick={() => void openMasterCard(row)}
                          >
                            <IdCardIcon />
                            <span className="visually-hidden">
                              {copy.itemCard}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="purchase-action-icon-btn edit"
                            disabled={busy || posting}
                            aria-label={`${copy.editRow}: ${row.itemDisplayName}`}
                            title={copy.editRow}
                            onClick={() => startEditingRow(row)}
                          >
                            <EditIcon />
                            <span className="visually-hidden">
                              {copy.editRow}: {row.itemDisplayName}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="purchase-action-icon-btn delete"
                            disabled={busy || posting}
                            aria-label={`${copy.deleteRow}: ${row.itemDisplayName}`}
                            title={copy.deleteRow}
                            onClick={() => void deleteRow(row)}
                          >
                            <TrashIcon />
                            <span className="visually-hidden">
                              {copy.deleteRow}: {row.itemDisplayName}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr
              className="purchase-entry-row"
              data-entry-epoch={entryEpoch}
              onFocus={() => {
                if (selectedRowId !== null) {
                  setSelectedRowId(null);
                  setSelectedRowProduct(null);
                }
              }}
              onClick={() => {
                if (selectedRowId !== null) {
                  setSelectedRowId(null);
                  setSelectedRowProduct(null);
                }
              }}
            >
              <th scope="row" data-column-field="ordinal">
                {draft.rows.length + 1}
              </th>
              {visibleColumns.map(({ field }) => (
                <td key={field} data-column-field={field}>
                  {renderEditor(field)}
                </td>
              ))}
              <td data-column-field="inventory-units">
                {product === null
                  ? "—"
                  : previewInventoryUnits(product, unitKey, quantity)}
              </td>
              <td data-column-field="actions">
                <div className="purchase-row-actions-cell">
                  <details
                    ref={optionalRef}
                    className={`purchase-row-optional-details ${
                      optionalOpensUpward ? "opens-upwards" : ""
                    }`}
                    onToggle={(event) => {
                      const isOpen = event.currentTarget.open;
                      setIsOptionalOpen(isOpen);
                      if (isOpen) {
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        const spaceBelow = window.innerHeight - rect.bottom;
                        const spaceAbove = rect.top;
                        setOptionalOpensUpward(
                          spaceBelow < 380 && spaceAbove > spaceBelow,
                        );
                        queueMicrotask(() => optionalUnitRef.current?.focus());
                      }
                    }}
                  >
                    <summary
                      className="purchase-row-action-btn optional"
                      aria-label={copy.optionalControls}
                      title={copy.optionalControls}
                    >
                      <span aria-hidden="true">⚙</span>
                      {hasActiveOptionalFields ? (
                        <span
                          className="purchase-row-action-dot"
                          aria-hidden="true"
                        />
                      ) : null}
                    </summary>
                    <div className="purchase-optional-controls-body">
                      <div className="purchase-optional-header">
                        <div>
                          <strong>{copy.optionalControls}</strong>
                          {product !== null ? (
                            <span
                              className="purchase-optional-product-tag"
                              title={product.displayName}
                            >
                              {product.displayName}
                            </span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="quiet-button purchase-optional-close"
                          aria-label={copy.closeSettings}
                          onClick={() => {
                            if (optionalRef.current) {
                              optionalRef.current.open = false;
                            }
                            setIsOptionalOpen(false);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                      {product === null ? (
                        <div className="purchase-optional-notice">
                          <span
                            className="purchase-optional-notice-icon"
                            aria-hidden="true"
                          >
                            ℹ
                          </span>
                          <span>{copy.unitHint}</span>
                          <button
                            type="button"
                            className="quiet-button purchase-optional-focus-item-btn"
                            onClick={() => {
                              if (optionalRef.current) {
                                optionalRef.current.open = false;
                              }
                              setIsOptionalOpen(false);
                              fieldRefs.current["item"]?.focus();
                            }}
                          >
                            {copy.itemBarcode} ↵
                          </button>
                        </div>
                      ) : null}
                      <div className="purchase-optional-fields">
                        <label className="purchase-optional-unit-label">
                          <span className="purchase-optional-label-text">
                            {copy.rowUnit}
                          </span>
                          <select
                            ref={optionalUnitRef}
                            value={unitKey}
                            disabled={product === null}
                            className={
                              product === null ? "is-disabled" : undefined
                            }
                            onChange={(event) => setUnitKey(event.target.value)}
                          >
                            {unitOptions(product, copy)}
                          </select>
                          {product === null ? (
                            <span className="purchase-optional-field-hint">
                              {copy.unitHint}
                            </span>
                          ) : product.packaging.packageUnits.length === 0 ? (
                            <span className="purchase-optional-field-hint">
                              {copy.singleUnitOnly}
                            </span>
                          ) : null}
                        </label>
                        {product?.pricing.method === "by-percentage" ? (
                          <label>
                            <span className="purchase-optional-label-text">
                              {copy.rowMargin}
                            </span>
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
                          <span className="purchase-optional-label-text">
                            {copy.lot}
                          </span>
                          <input
                            maxLength={120}
                            value={lotNumber}
                            onChange={(event) =>
                              setLotNumber(event.target.value)
                            }
                          />
                        </label>
                        <label className="purchase-optional-notes-field">
                          <span className="purchase-optional-label-text">
                            {copy.notes}
                          </span>
                          <textarea
                            maxLength={1000}
                            rows={3}
                            value={notes}
                            onChange={(event) => setNotes(event.target.value)}
                          />
                        </label>
                      </div>
                      <div className="purchase-optional-footer">
                        <button
                          type="button"
                          className="primary-button purchase-optional-done-btn"
                          onClick={() => {
                            if (optionalRef.current) {
                              optionalRef.current.open = false;
                            }
                            setIsOptionalOpen(false);
                          }}
                        >
                          {copy.done}
                        </button>
                      </div>
                    </div>
                  </details>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

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

      <PurchaseReview
        draft={draft}
        onPost={onPost}
        postDenial={postDenial}
        posting={posting}
      />
      {masterCardProduct === null ? null : (
        <MasterProductDialog
          baseUrl={baseUrl}
          product={masterCardProduct}
          onCancel={handleMasterCardCancel}
          onSuccess={handleMasterCardSuccess}
        />
      )}
      {quickCreateValue === null ? null : (
        <QuickProductDialog
          baseUrl={baseUrl}
          initialValue={quickCreateValue}
          onCancel={handleQuickCreateCancel}
          onSuccess={handleQuickCreateSuccess}
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
          <div
            className="purchase-item-combobox"
            ref={comboboxRef}
            role="combobox"
            aria-expanded={isSuggestionsOpen}
            aria-haspopup="listbox"
            aria-owns={
              isSuggestionsOpen
                ? "purchase-item-suggestions-listbox"
                : undefined
            }
          >
            <div className="purchase-item-control">
              <input
                {...common}
                aria-autocomplete="list"
                aria-controls={
                  isSuggestionsOpen
                    ? "purchase-item-suggestions-listbox"
                    : undefined
                }
                aria-activedescendant={
                  highlightedIndex >= 0 && suggestions[highlightedIndex]
                    ? `purchase-item-opt-${suggestions[highlightedIndex]!.product.id}`
                    : undefined
                }
                aria-label={copy.itemBarcode}
                autoComplete="off"
                value={itemQuery}
                onChange={handleItemChange}
                onKeyDown={handleItemKeyDown}
              />
              {isSearching ? (
                <span
                  className="status-spinner purchase-item-spinner"
                  aria-hidden="true"
                />
              ) : null}
            </div>
            {isSuggestionsOpen ? (
              <div
                id="purchase-item-suggestions-listbox"
                className="purchase-item-dropdown"
                role="listbox"
                aria-label={copy.searchSuggestions}
              >
                {suggestions.length === 0 && !isSearching ? (
                  <div
                    className="purchase-item-suggestion-empty"
                    role="presentation"
                  >
                    {copy.noMatchingProducts}
                  </div>
                ) : null}
                {isSearching && suggestions.length === 0 ? (
                  <div className="purchase-item-searching" role="presentation">
                    <span
                      className="status-spinner purchase-item-spinner"
                      aria-hidden="true"
                    />
                    <span>{copy.searching}</span>
                  </div>
                ) : null}
                {suggestions.length > 0 ? (
                  <ul className="purchase-item-suggestions-list">
                    {suggestions.map((item, idx) => {
                      const isHighlighted = idx === highlightedIndex;
                      return (
                        <li
                          key={item.product.id}
                          id={`purchase-item-opt-${item.product.id}`}
                          ref={(el) => {
                            optionRefs.current[idx] = el;
                          }}
                          role="option"
                          aria-selected={isHighlighted}
                          className={`purchase-item-suggestion ${
                            isHighlighted ? "is-highlighted" : ""
                          }`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            attachProduct(item.product);
                            focusNext("item", item.product);
                          }}
                          onMouseEnter={() => setHighlightedIndex(idx)}
                        >
                          <div className="purchase-item-suggestion-main">
                            <div className="purchase-item-suggestion-title">
                              <span className="purchase-item-name">
                                {item.product.displayName}
                              </span>
                              {item.matchedField === "barcode" &&
                              item.matchedBarcode ? (
                                <span className="purchase-item-badge purchase-item-badge-barcode">
                                  {copy.matchedBarcode}:{" "}
                                  {item.matchedBarcode.value}
                                </span>
                              ) : null}
                              {item.matchedField === "arabic-name" ? (
                                <span className="purchase-item-badge purchase-item-badge-arabic">
                                  {copy.matchedArabic}
                                </span>
                              ) : null}
                            </div>
                            <div className="purchase-item-suggestion-meta">
                              {item.product.arabicSearchName ? (
                                <span
                                  className="purchase-item-arabic"
                                  dir="rtl"
                                >
                                  {item.product.arabicSearchName}
                                </span>
                              ) : null}
                              {item.product.scientificName ? (
                                <span className="purchase-item-scientific">
                                  {item.product.scientificName}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="purchase-item-suggestion-details">
                            <span className="purchase-item-unit">
                              {formatPurchaseDefaultUnit(item.product)}
                            </span>
                            {item.product.pricing.retailPriceFils ? (
                              <span className="purchase-item-price">
                                {formatFilsToIqd(
                                  item.product.pricing.retailPriceFils,
                                  locale,
                                )}
                              </span>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      case "quantity":
        return (
          <input
            {...common}
            aria-label={copy.rowQuantity}
            type="number"
            min={1}
            className="purchase-stepper-input w-full"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        );
      case "cost":
        return (
          <input
            {...common}
            aria-label={copy.rowCost}
            type="number"
            min={0}
            className="purchase-stepper-input w-full"
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
            type="number"
            min={0}
            className="purchase-stepper-input w-full"
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
            className="purchase-date-input"
            value={expiryDate}
            onChange={(event) => setExpiryDate(event.target.value)}
          />
        );
    }
  }

  function renderInlineEditor(
    row: PurchaseDraftDetail["rows"][number],
    field: PurchaseEntryColumnField,
  ): React.JSX.Element {
    switch (field) {
      case "item":
        return (
          <span className="purchase-row-edit-item" title={row.itemDisplayName}>
            {row.itemDisplayName}
          </span>
        );
      case "quantity":
        return (
          <input
            className="purchase-row-edit-input purchase-stepper-input w-full"
            aria-label={copy.rowQuantity}
            type="number"
            min={1}
            value={editQuantity}
            onChange={(e) => setEditQuantity(e.target.value)}
            onKeyDown={(e) => handleEditKeyDown(row, e)}
          />
        );
      case "cost":
        return (
          <input
            className="purchase-row-edit-input purchase-stepper-input w-full"
            aria-label={copy.rowCost}
            type="number"
            min={0}
            value={editCostFils}
            onChange={(e) => {
              setEditCostFils(e.target.value);
              if (row.pricingMethod === "by-percentage") {
                setEditRetailPriceFils(
                  calculatePurchaseRetailPreview(
                    e.target.value,
                    editMarginPercentage,
                    "nearest-250-iqd",
                  ),
                );
              }
            }}
            onKeyDown={(e) => handleEditKeyDown(row, e)}
          />
        );
      case "selling-price": {
        const locked = row.pricingMethod === "by-percentage";
        return (
          <input
            className="purchase-row-edit-input purchase-stepper-input w-full"
            aria-label={copy.sellingPrice}
            type="number"
            min={0}
            readOnly={locked}
            tabIndex={locked ? -1 : 0}
            title={locked ? copy.lockedByPercentage : undefined}
            value={editRetailPriceFils}
            onChange={(e) => setEditRetailPriceFils(e.target.value)}
            onKeyDown={(e) => handleEditKeyDown(row, e)}
          />
        );
      }
      case "expiry":
        return (
          <input
            className="purchase-row-edit-input purchase-date-input"
            aria-label={copy.rowExpiry}
            type="date"
            autoFocus
            value={editExpiryDate}
            onChange={(e) => setEditExpiryDate(e.target.value)}
            onKeyDown={(e) => handleEditKeyDown(row, e)}
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

function MasterProductDialog({
  baseUrl,
  product,
  onCancel,
  onSuccess,
}: {
  readonly baseUrl: string;
  readonly product: Product;
  readonly onCancel: () => void;
  readonly onSuccess: (product: Product) => void;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (
      document.activeElement === null ||
      !dialog.contains(document.activeElement)
    ) {
      const focusable = dialog.querySelector<HTMLElement>(
        "input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      );
      focusable?.focus();
    }
  }, []);

  useLayoutEffect(() => {
    const cancelOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCancelRef.current();
    };
    window.addEventListener("keydown", cancelOnEscape, true);
    return () => window.removeEventListener("keydown", cancelOnEscape, true);
  }, []);

  return (
    <div
      className="dialog-backdrop purchase-product-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="master-product-title"
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
        <h2 id="master-product-title">{copy.currentMasterRecord}</h2>
        <p>{copy.itemMasterRecordHint}</p>
        <ProductForm
          baseUrl={baseUrl}
          initialProduct={product}
          onCancel={onCancel}
          onSuccess={onSuccess}
        />
      </div>
    </div>
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
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (
      document.activeElement === null ||
      !dialog.contains(document.activeElement)
    ) {
      const focusable = dialog.querySelector<HTMLElement>(
        "input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      );
      focusable?.focus();
    }
  }, []);

  useLayoutEffect(() => {
    const cancelOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCancelRef.current();
    };
    window.addEventListener("keydown", cancelOnEscape, true);
    return () => window.removeEventListener("keydown", cancelOnEscape, true);
  }, []);
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
  onPost,
  postDenial,
  posting,
}: {
  readonly draft: PurchaseDraftDetail;
  readonly onPost: () => Promise<void>;
  readonly postDenial: PurchasingDenial | null;
  readonly posting: boolean;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  return (
    <section
      className="purchase-review"
      aria-labelledby="purchase-review-title"
    >
      <h3 id="purchase-review-title">{copy.review}</h3>
      <dl className="purchase-review-stats-grid">
        <div className="purchase-review-stat">
          <dt className="purchase-review-stat-label">{copy.gross}</dt>
          <dd className="purchase-review-stat-value">
            <bdi>{draft.review.grossFils}</bdi> {copy.fils}
          </dd>
        </div>
        <div className="purchase-review-stat">
          <dt className="purchase-review-stat-label">{copy.discount}</dt>
          <dd className="purchase-review-stat-value">
            <bdi>{draft.review.allowanceFils}</bdi> {copy.fils}
          </dd>
        </div>
        <div className="purchase-review-stat">
          <dt className="purchase-review-stat-label">{copy.net}</dt>
          <dd className="purchase-review-stat-value">
            <bdi>{draft.review.netFils}</bdi> {copy.fils}
          </dd>
        </div>
        <div className="purchase-review-stat">
          <dt className="purchase-review-stat-label">
            {draft.review.settlementEffect.context === "cash"
              ? copy.tenderEffect
              : copy.payableEffect}
          </dt>
          <dd className="purchase-review-stat-value is-emphasis">
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
                : copy.missingLotWarning}
            </li>
          ))}
        </ul>
      </div>
      {postDenial === null ? null : (
        <div
          className="form-error purchase-post-denial"
          id="purchase-post-denial"
          role="alert"
          aria-live="assertive"
          data-denial-code={postDenial.code}
          data-denial-rule={postDenial.fieldErrors[0]?.rule}
        >
          {postDenial.code === "expiry-required" ||
          postDenial.fieldErrors.some(
            (e) => e.rule === "purchase.post.expiry-required-at-receipt",
          )
            ? copy.expiryRequiredPost
            : postDenial.code === "lot-required" ||
                postDenial.fieldErrors.some(
                  (e) => e.rule === "purchase.post.lot-required-at-receipt",
                )
              ? copy.lotRequiredPost
              : postDenial.code === "version-conflict"
                ? copy.versionConflictPost
                : copy.postRejected}
        </div>
      )}
      <div className="purchase-review-actions">
        <button
          type="button"
          className="primary-button"
          disabled={draft.rows.length === 0 || posting}
          aria-describedby={
            postDenial === null ? undefined : "purchase-post-denial"
          }
          onClick={() => void onPost()}
        >
          {posting ? copy.posting : copy.post}
        </button>
      </div>
    </section>
  );
}

const POST_FIELD: Record<PurchaseEntryColumnField, string> = {
  cost: "primarySupplierCostFils",
  expiry: "expiryDate",
  item: "itemId",
  quantity: "enteredQuantity",
  "selling-price": "pricing",
};

function isPostFieldError(
  denial: PurchasingDenial | null,
  rowIndex: number,
  field: string,
): boolean {
  return (
    denial?.fieldErrors.some(
      (error) =>
        error.path[0] === "rows" &&
        error.path[1] === rowIndex &&
        error.path[2] === field,
    ) ?? false
  );
}

function committedValue(
  field: PurchaseEntryColumnField,
  row: PurchaseDraftDetail["rows"][number],
  copy: (typeof purchasingMessages)["en"] | (typeof purchasingMessages)["ar"],
): React.ReactNode {
  switch (field) {
    case "item":
      return (
        <div className="purchase-row-item-cell">
          <span className="purchase-row-item-name">{row.itemDisplayName}</span>
          {row.lotNumber !== null || row.notes !== null ? (
            <div className="purchase-row-item-badges">
              {row.lotNumber !== null ? (
                <span
                  className="purchase-row-badge lot"
                  title={`${copy.lot}: ${row.lotNumber}`}
                >
                  🏷️ {row.lotNumber}
                </span>
              ) : null}
              {row.notes !== null ? (
                <span
                  className="purchase-row-badge notes"
                  title={`${copy.notes}: ${row.notes}`}
                >
                  📝
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      );
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
function unitOptions(
  product: Product | null,
  copy: { unitSelectProductFirst: string; baseUnitBadge: string },
): React.JSX.Element[] {
  if (product === null)
    return [
      <option key="none" value="inventory-unit">
        {copy.unitSelectProductFirst}
      </option>,
    ];
  return [
    <option key="inventory" value="inventory-unit">
      {product.packaging.inventoryUnitName} ({copy.baseUnitBadge})
    </option>,
    ...product.packaging.packageUnits.map((unit) => (
      <option key={unit.name} value={`package:${unit.name}`}>
        {unit.name} ({unit.baseUnitsPerPackage}{" "}
        {product.packaging.inventoryUnitName})
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

export function formatPurchaseDefaultUnit(product: Product): string {
  const purchaseUnit = product.packaging.defaultUnits.purchase;
  if (purchaseUnit.kind === "inventory-unit") {
    return product.packaging.inventoryUnitName;
  }
  const pkg = product.packaging.packageUnits.find(
    (u) => u.name === purchaseUnit.packageUnitName,
  );
  if (pkg) {
    return `${pkg.name} (${pkg.baseUnitsPerPackage} ${product.packaging.inventoryUnitName})`;
  }
  return purchaseUnit.packageUnitName;
}

export function determineDisplayedProduct({
  selectedRowProduct,
  entryRowProduct,
  highlightedProduct,
  isRowSelected,
}: {
  readonly selectedRowProduct: Product | null;
  readonly entryRowProduct: Product | null;
  readonly highlightedProduct?: Product | null;
  readonly isRowSelected: boolean;
}): Product | null {
  if (isRowSelected) return selectedRowProduct;
  if (highlightedProduct !== undefined && highlightedProduct !== null) {
    return highlightedProduct;
  }
  return entryRowProduct;
}

export function updateDraftRowProductAttributes(
  rows: PurchaseDraftDetail["rows"],
  updatedProduct: Product,
): {
  hasChanges: boolean;
  rows: PurchaseDraftDetail["rows"];
} {
  let hasChanges = false;
  const updatedRows = rows.map((row) => {
    if (row.itemId !== updatedProduct.id) {
      return row;
    }
    const nameChanged = row.itemDisplayName !== updatedProduct.displayName;
    const unitChanged =
      row.inventoryUnitName !== updatedProduct.packaging.inventoryUnitName;
    if (nameChanged || unitChanged) {
      hasChanges = true;
      return {
        ...row,
        itemDisplayName: updatedProduct.displayName,
        inventoryUnitName: updatedProduct.packaging.inventoryUnitName,
      };
    }
    return row;
  });
  return { hasChanges, rows: updatedRows };
}

export function IdCardIcon({
  className = "purchase-icon",
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M16 10h2" />
      <path d="M16 14h2" />
      <path d="M6.17 15a3 3 0 0 1 5.66 0" />
      <circle cx="9" cy="11" r="2" />
      <rect x="2" y="5" width="20" height="14" rx="2" />
    </svg>
  );
}

export function BarcodeIcon({
  className = "purchase-icon",
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 5v14" />
      <path d="M8 5v14" />
      <path d="M12 5v14" />
      <path d="M17 5v14" />
      <path d="M21 5v14" />
    </svg>
  );
}

export function EditIcon({
  className = "purchase-icon",
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export function TrashIcon({
  className = "purchase-icon",
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

export function CheckIcon({
  className = "purchase-icon",
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function CloseIcon({
  className = "purchase-icon",
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
