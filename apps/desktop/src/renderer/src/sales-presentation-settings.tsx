import {
  SALE_QUICK_ACCESS_REPLACE_MAX_BODY_BYTES,
  SALE_ITEM_PANEL_FIELDS,
  type SalePanelSettings,
  type SaleQuickAccess,
  type SaleQuickAccessReplaceRequest,
} from "@breev/contracts/local-rest";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type React from "react";

import { directionForLocale, formatCurrencyFromFils } from "./preferences";
import type { Locale } from "./preferences";
import {
  getSalesPanelMessages,
  type SaleItemPanelField,
} from "./sales-panel-messages";

import "./sales-panel.css";

export interface SalesPresentationSettingsProps {
  readonly value: SaleQuickAccess;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly error: string | null;
  readonly retryRequired?: boolean;
  readonly onSave: (input: {
    categories: SaleQuickAccessReplaceRequest["categories"];
    panelSettings: SalePanelSettings;
  }) => void;
  readonly onClose: () => void;
}

interface DraftTile {
  readonly draftId: string;
  readonly productId: string;
  readonly unitId: string;
  readonly available: boolean;
  readonly thumbnailDataUrl: string | null;
  readonly displayName: string | null;
  readonly unitName: string | null;
  readonly currentUnitPriceFils: string | null;
}

interface DraftCategory {
  readonly draftId: string;
  readonly name: string;
  readonly tiles: readonly DraftTile[];
}

const MAX_IMAGE_BYTES = 70 * 1024; // 70 KB
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const DATA_URL_IMAGE_REGEX =
  /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/u;

export function SalesPresentationSettings({
  value,
  locale,
  busy,
  error,
  retryRequired = false,
  onSave,
  onClose,
}: SalesPresentationSettingsProps): React.JSX.Element {
  const messages = getSalesPanelMessages(locale);
  const dir = directionForLocale(locale);
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const nextDraftId = useRef(0);
  const allocateDraftId = (): string =>
    `${titleId}-new-${nextDraftId.current++}`;
  const editingDisabled = busy || retryRequired;
  const mountedRef = useRef(false);
  const imageReaders = useRef(new Map<string, FileReader>());
  const imageReadGenerations = useRef(new Map<string, number>());
  const [pendingImageTileIds, setPendingImageTileIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  // Controlled draft state starting from value (transient, no durable storage)
  const [panelSettings, setPanelSettings] = useState<SalePanelSettings>(() => ({
    visibleFields: [...value.panelSettings.visibleFields],
    consumptionMonths: value.panelSettings.consumptionMonths,
    showDrawerBalance: value.panelSettings.showDrawerBalance,
  }));

  const [categories, setCategories] = useState<readonly DraftCategory[]>(() =>
    value.categories.map((cat, categoryIndex) => ({
      draftId: `${titleId}-initial-category-${categoryIndex}`,
      name: cat.name,
      tiles: cat.tiles.map((tile, tileIndex) => ({
        draftId: `${titleId}-initial-tile-${categoryIndex}-${tileIndex}`,
        productId: tile.productId,
        unitId: tile.unitId,
        available: tile.available,
        thumbnailDataUrl: tile.thumbnailDataUrl,
        displayName: tile.displayName,
        unitName: tile.unitName,
        currentUnitPriceFils: tile.currentUnitPriceFils,
      })),
    })),
  );

  const [activeTab, setActiveTab] = useState<"fields" | "quickAccess">(
    "fields",
  );
  const [newCategoryName, setNewCategoryName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const setImageReadPending = (tileId: string, pending: boolean): void => {
    setPendingImageTileIds((current) => {
      if (current.has(tileId) === pending) return current;
      const next = new Set(current);
      if (pending) next.add(tileId);
      else next.delete(tileId);
      return next;
    });
  };

  const invalidateTileImageRead = (tileId: string): void => {
    imageReadGenerations.current.set(
      tileId,
      (imageReadGenerations.current.get(tileId) ?? 0) + 1,
    );
    const reader = imageReaders.current.get(tileId);
    imageReaders.current.delete(tileId);
    setImageReadPending(tileId, false);
    reader?.abort();
  };

  // Commit focus with the dialog and cancel any outstanding file reads on close.
  useLayoutEffect(() => {
    mountedRef.current = true;
    dialogRef.current?.focus();
    return () => {
      mountedRef.current = false;
      for (const reader of imageReaders.current.values()) reader.abort();
      imageReaders.current.clear();
    };
  }, []);

  // Trap focus & handle Escape key
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!editingDisabled) onClose();
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(
      (element) =>
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== "hidden",
    );

    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const activeIndex = focusable.indexOf(
      document.activeElement as HTMLElement,
    );

    if (event.shiftKey && activeIndex <= 0) {
      event.preventDefault();
      focusable[focusable.length - 1]?.focus();
    } else if (
      !event.shiftKey &&
      (activeIndex === -1 || activeIndex === focusable.length - 1)
    ) {
      event.preventDefault();
      focusable[0]?.focus();
    }
  };

  // Field toggles
  const handleToggleField = (field: SaleItemPanelField): void => {
    setPanelSettings((prev) => {
      const exists = prev.visibleFields.includes(field);
      const visibleFields = exists
        ? prev.visibleFields.filter((f) => f !== field)
        : [...prev.visibleFields, field];
      return { ...prev, visibleFields };
    });
    setValidationError(null);
  };

  // Consumption months selection (1 | 2 | 3)
  const handleSelectMonths = (months: 1 | 2 | 3): void => {
    setPanelSettings((prev) => ({
      ...prev,
      consumptionMonths: months,
    }));
  };

  // Drawer balance toggle
  const handleToggleDrawer = (checked: boolean): void => {
    setPanelSettings((prev) => ({
      ...prev,
      showDrawerBalance: checked,
    }));
  };

  // Category manipulations
  const handleAddCategory = (e: React.SyntheticEvent): void => {
    e.preventDefault();
    const trimmed = newCategoryName.trim();
    if (!trimmed || trimmed.length > 64) {
      setValidationError(messages.categoryNameRequiredError);
      return;
    }
    if (categories.length >= 12) {
      setValidationError(messages.maxCategoriesReachedError);
      return;
    }
    const newCategory = {
      draftId: allocateDraftId(),
      name: trimmed,
      tiles: [],
    };
    setCategories((prev) => [...prev, newCategory]);
    setNewCategoryName("");
    setValidationError(null);
  };

  const handleRenameCategory = (index: number, newName: string): void => {
    setCategories((prev) =>
      prev.map((cat, i) => (i === index ? { ...cat, name: newName } : cat)),
    );
  };

  const handleMoveCategory = (index: number, delta: -1 | 1): void => {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= categories.length) return;
    setCategories((prev) => {
      const next = [...prev];
      const item = next[index];
      const target = next[targetIndex];
      if (!item || !target) return prev;
      next[index] = target;
      next[targetIndex] = item;
      return next;
    });
  };

  const handleDeleteCategory = (categoryId: string): void => {
    const category = categories.find((item) => item.draftId === categoryId);
    category?.tiles.forEach((tile) => invalidateTileImageRead(tile.draftId));
    setCategories((prev) =>
      prev.filter((category) => category.draftId !== categoryId),
    );
  };

  // Tile manipulations
  const handleMoveTile = (
    catIndex: number,
    tileIndex: number,
    delta: -1 | 1,
  ): void => {
    const targetIndex = tileIndex + delta;
    setCategories((prev) =>
      prev.map((cat, cIdx) => {
        if (cIdx !== catIndex) return cat;
        if (targetIndex < 0 || targetIndex >= cat.tiles.length) return cat;
        const nextTiles = [...cat.tiles];
        const tile = nextTiles[tileIndex];
        const target = nextTiles[targetIndex];
        if (!tile || !target) return cat;
        nextTiles[tileIndex] = target;
        nextTiles[targetIndex] = tile;
        return { ...cat, tiles: nextTiles };
      }),
    );
  };

  const handleRemoveTile = (categoryId: string, tileId: string): void => {
    invalidateTileImageRead(tileId);
    setCategories((prev) =>
      prev.map((cat) => {
        if (cat.draftId !== categoryId) return cat;
        return {
          ...cat,
          tiles: cat.tiles.filter((tile) => tile.draftId !== tileId),
        };
      }),
    );
  };

  // Tile image selection & removal
  const handleTileImageFile = (
    categoryId: string,
    tileId: string,
    file: File | undefined,
  ): void => {
    if (!file) return;

    const generation = (imageReadGenerations.current.get(tileId) ?? 0) + 1;
    imageReadGenerations.current.set(tileId, generation);
    const previousReader = imageReaders.current.get(tileId);
    imageReaders.current.delete(tileId);
    setImageReadPending(tileId, false);
    previousReader?.abort();

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setImageError(messages.imageTypeUnsupportedError);
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(messages.imageTooLargeError);
      return;
    }

    setImageError(null);
    const reader = new FileReader();
    imageReaders.current.set(tileId, reader);
    setImageReadPending(tileId, true);
    const isCurrentRead = (): boolean =>
      mountedRef.current &&
      imageReadGenerations.current.get(tileId) === generation;
    const finishRead = (): void => {
      if (!isCurrentRead()) return;
      imageReaders.current.delete(tileId);
      setImageReadPending(tileId, false);
    };

    reader.onload = (): void => {
      if (!isCurrentRead()) return;
      const result = reader.result;
      if (typeof result === "string" && DATA_URL_IMAGE_REGEX.test(result)) {
        setCategories((prev) =>
          prev.map((cat) => {
            if (cat.draftId !== categoryId) return cat;
            return {
              ...cat,
              tiles: cat.tiles.map((tile) =>
                tile.draftId === tileId
                  ? { ...tile, thumbnailDataUrl: result }
                  : tile,
              ),
            };
          }),
        );
      } else {
        setImageError(messages.imageTypeUnsupportedError);
      }
      finishRead();
    };
    reader.onerror = (): void => {
      if (!isCurrentRead()) return;
      setImageError(messages.imageReadError);
      finishRead();
    };
    reader.onabort = (): void => {
      finishRead();
    };
    try {
      reader.readAsDataURL(file);
    } catch {
      if (!isCurrentRead()) return;
      setImageError(messages.imageReadError);
      finishRead();
    }
  };

  const handleRemoveTileImage = (categoryId: string, tileId: string): void => {
    invalidateTileImageRead(tileId);
    setImageError(null);
    setCategories((prev) =>
      prev.map((cat) => {
        if (cat.draftId !== categoryId) return cat;
        return {
          ...cat,
          tiles: cat.tiles.map((tile) =>
            tile.draftId === tileId
              ? { ...tile, thumbnailDataUrl: null }
              : tile,
          ),
        };
      }),
    );
  };

  // Form submit & save
  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    if (pendingImageTileIds.size > 0) return;

    const categoriesPayload: SaleQuickAccessReplaceRequest["categories"] =
      categories.map((cat) => ({
        name: cat.name.trim(),
        tiles: cat.tiles.map((tile) => ({
          productId: tile.productId,
          unitId: tile.unitId,
          ...(tile.thumbnailDataUrl
            ? { thumbnailDataUrl: tile.thumbnailDataUrl }
            : {}),
        })),
      }));

    // The parent retries its stable request when delivery is uncertain. This
    // editor is frozen in that state, so send the same draft back to that seam.
    if (retryRequired) {
      onSave({ categories: categoriesPayload, panelSettings });
      return;
    }

    // Validate category names
    for (const cat of categories) {
      const trimmed = cat.name.trim();
      if (!trimmed || trimmed.length > 64) {
        setValidationError(messages.categoryNameRequiredError);
        setActiveTab("quickAccess");
        return;
      }
    }

    setValidationError(null);
    setImageError(null);

    const maxVersion = "9".repeat(19);
    const sampleIdempotencyKey = "00000000-0000-0000-0000-000000000000";
    const requestBytes = new TextEncoder().encode(
      JSON.stringify({
        expectedVersion: maxVersion,
        idempotencyKey: sampleIdempotencyKey,
        categories: categoriesPayload,
        panelSettings,
      }),
    ).byteLength;
    if (requestBytes > SALE_QUICK_ACCESS_REPLACE_MAX_BODY_BYTES) {
      setImageError(messages.quickAccessPayloadTooLargeError);
      setActiveTab("quickAccess");
      return;
    }

    onSave({
      categories: categoriesPayload,
      panelSettings,
    });
  };

  return (
    <div className="sales-presentation-settings" dir={dir}>
      <div
        aria-describedby={descId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="sales-presentation-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <header className="sales-presentation-header">
          <div className="sales-presentation-title-wrap">
            <h2 className="sales-presentation-title" id={titleId}>
              {messages.settingsModalTitle}
            </h2>
            <p className="sales-presentation-desc" id={descId}>
              {messages.settingsModalDescription}
            </p>
          </div>
          <button
            aria-label={messages.closeButton}
            className="sales-presentation-close-btn"
            disabled={editingDisabled}
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {/* Tab navigation */}
        <nav
          aria-label={messages.settingsModalTitle}
          className="sales-presentation-tabs"
        >
          <button
            className={`sales-presentation-tab-btn${activeTab === "fields" ? " active" : ""}`}
            aria-pressed={activeTab === "fields"}
            type="button"
            onClick={() => setActiveTab("fields")}
          >
            {messages.tabFields}
          </button>
          <button
            className={`sales-presentation-tab-btn${activeTab === "quickAccess" ? " active" : ""}`}
            aria-pressed={activeTab === "quickAccess"}
            type="button"
            onClick={() => setActiveTab("quickAccess")}
          >
            {messages.tabQuickAccess}
          </button>
        </nav>

        {/* Form & Scrollable Body */}
        <form
          aria-busy={pendingImageTileIds.size > 0}
          className="sales-presentation-body"
          onSubmit={handleSubmit}
        >
          <div className="sales-presentation-scroll-content">
            {/* Server or Action Error Announcement */}
            {error !== null ? (
              <p className="sales-presentation-alert" role="alert">
                {error}
              </p>
            ) : null}

            {/* Local Validation Error Announcement */}
            {validationError !== null ? (
              <p className="sales-presentation-alert" role="alert">
                {validationError}
              </p>
            ) : null}

            {/* Image Upload Error Announcement */}
            {imageError !== null ? (
              <p className="sales-presentation-alert" role="alert">
                {imageError}
              </p>
            ) : null}

            {/* Tab 1: Item Panel Fields & Preferences */}
            {activeTab === "fields" ? (
              <>
                {/* Field Visibility */}
                <section className="sales-presentation-section">
                  <h3 className="sales-presentation-section-title">
                    {messages.fieldsSectionTitle}
                  </h3>
                  <p className="sales-presentation-section-hint">
                    {messages.fieldsSectionHint}
                  </p>
                  <div className="sales-presentation-fields-grid">
                    {SALE_ITEM_PANEL_FIELDS.map((field) => {
                      const checked =
                        panelSettings.visibleFields.includes(field);
                      return (
                        <label
                          className="sales-presentation-field-item"
                          key={field}
                        >
                          <input
                            checked={checked}
                            disabled={editingDisabled}
                            type="checkbox"
                            onChange={() => handleToggleField(field)}
                          />
                          <span className="sales-presentation-field-label">
                            {messages.fieldLabels[field]}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>

                {/* Consumption Months Choice */}
                <section className="sales-presentation-section">
                  <h3 className="sales-presentation-section-title">
                    {messages.consumptionSectionTitle}
                  </h3>
                  <div className="sales-presentation-options-row">
                    {([1, 2, 3] as const).map((months) => (
                      <label
                        className="sales-presentation-option-pill"
                        key={months}
                      >
                        <input
                          checked={panelSettings.consumptionMonths === months}
                          disabled={editingDisabled}
                          name="consumptionMonths"
                          type="radio"
                          onChange={() => handleSelectMonths(months)}
                        />
                        <span>{messages.consumptionMonthsOptions[months]}</span>
                      </label>
                    ))}
                  </div>
                </section>

                {/* Drawer Balance Visibility */}
                <section className="sales-presentation-section">
                  <h3 className="sales-presentation-section-title">
                    {messages.drawerBalanceSectionTitle}
                  </h3>
                  <label className="sales-presentation-field-item">
                    <input
                      checked={panelSettings.showDrawerBalance}
                      disabled={editingDisabled}
                      type="checkbox"
                      onChange={(e) => handleToggleDrawer(e.target.checked)}
                    />
                    <span className="sales-presentation-field-label">
                      {messages.drawerBalanceLabel}
                    </span>
                  </label>
                </section>
              </>
            ) : null}

            {/* Tab 2: Quick-Access Categories & Tiles */}
            {activeTab === "quickAccess" ? (
              <section className="sales-presentation-section">
                <h3 className="sales-presentation-section-title">
                  {messages.quickAccessSectionTitle}
                </h3>
                <p className="sales-presentation-section-hint">
                  {messages.quickAccessSectionHint}
                </p>
                <p className="sales-presentation-section-hint">
                  {messages.imageRequirementsHint}
                </p>

                {/* Add New Category Bar */}
                <div className="sales-presentation-add-cat-bar">
                  <input
                    aria-label={messages.newCategoryPlaceholder}
                    className="sales-presentation-input"
                    disabled={editingDisabled || categories.length >= 12}
                    maxLength={64}
                    placeholder={messages.newCategoryPlaceholder}
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.nativeEvent.isComposing
                      ) {
                        handleAddCategory(event);
                      }
                    }}
                  />
                  <button
                    className="sales-presentation-btn"
                    disabled={
                      editingDisabled ||
                      categories.length >= 12 ||
                      !newCategoryName.trim()
                    }
                    type="button"
                    onClick={handleAddCategory}
                  >
                    {messages.addCategoryButton}
                  </button>
                </div>

                {/* Empty Categories Prompt */}
                {categories.length === 0 ? (
                  <p className="sales-presentation-empty-notice">
                    {messages.noCategoriesPrompt}
                  </p>
                ) : null}

                {/* Categories List */}
                {categories.map((category, catIndex) => (
                  <div
                    className="sales-presentation-cat-card"
                    key={category.draftId}
                  >
                    {/* Category Header with Reorder, Rename, and Delete */}
                    <div className="sales-presentation-cat-header">
                      <div className="sales-presentation-cat-title-controls">
                        <input
                          aria-label={`${messages.categoryNameLabel} ${catIndex + 1}`}
                          className="sales-presentation-cat-name-input"
                          disabled={editingDisabled}
                          maxLength={64}
                          required
                          value={category.name}
                          onChange={(e) =>
                            handleRenameCategory(catIndex, e.target.value)
                          }
                        />
                      </div>
                      <div className="sales-presentation-order-btns">
                        <button
                          aria-label={`${messages.moveCategoryUp}: ${category.name}`}
                          className="sales-presentation-btn-icon"
                          disabled={editingDisabled || catIndex === 0}
                          title={messages.moveCategoryUp}
                          type="button"
                          onClick={() => handleMoveCategory(catIndex, -1)}
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`${messages.moveCategoryDown}: ${category.name}`}
                          className="sales-presentation-btn-icon"
                          disabled={
                            editingDisabled ||
                            catIndex === categories.length - 1
                          }
                          title={messages.moveCategoryDown}
                          type="button"
                          onClick={() => handleMoveCategory(catIndex, 1)}
                        >
                          ↓
                        </button>
                        <button
                          aria-label={`${messages.deleteCategory}: ${category.name}`}
                          className="sales-presentation-btn-icon sales-presentation-btn-danger"
                          disabled={editingDisabled}
                          title={messages.deleteCategory}
                          type="button"
                          onClick={() => handleDeleteCategory(category.draftId)}
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    {/* Tiles List in Category */}
                    <div className="sales-presentation-tiles-list">
                      {category.tiles.length === 0 ? (
                        <p className="sales-presentation-empty-notice">
                          {messages.emptyCategoryPrompt}
                        </p>
                      ) : (
                        category.tiles.map((tile, tileIndex) => (
                          <div
                            className="sales-presentation-tile-item"
                            key={tile.draftId}
                          >
                            <div className="sales-presentation-tile-info">
                              {/* Thumbnail Preview */}
                              <div className="sales-presentation-tile-thumb">
                                {tile.thumbnailDataUrl ? (
                                  <img
                                    alt={tile.displayName ?? ""}
                                    src={tile.thumbnailDataUrl}
                                  />
                                ) : (
                                  <span className="sales-presentation-tile-thumb-empty">
                                    {messages.noImage}
                                  </span>
                                )}
                              </div>
                              {/* Tile text details */}
                              <div className="sales-presentation-tile-text">
                                <p className="sales-presentation-tile-name">
                                  {tile.displayName ?? tile.productId}
                                </p>
                                <p className="sales-presentation-tile-meta">
                                  {tile.unitName ?? ""}
                                  {tile.currentUnitPriceFils !== null
                                    ? ` · ${formatCurrencyFromFils(BigInt(tile.currentUnitPriceFils), locale)}`
                                    : ""}
                                </p>
                              </div>
                            </div>

                            {/* Actions: Image selection, remove image, reorder, remove tile */}
                            <div className="sales-presentation-tile-actions">
                              <label className="sales-presentation-btn-subtle">
                                {messages.chooseTileImage}
                                <input
                                  accept="image/png,image/jpeg,image/webp"
                                  className="sales-presentation-file-input"
                                  disabled={editingDisabled}
                                  style={{ display: "inline-block" }}
                                  type="file"
                                  onChange={(e) => {
                                    handleTileImageFile(
                                      category.draftId,
                                      tile.draftId,
                                      e.target.files?.[0],
                                    );
                                    e.target.value = "";
                                  }}
                                />
                              </label>

                              {tile.thumbnailDataUrl ? (
                                <button
                                  className="sales-presentation-btn-subtle"
                                  disabled={editingDisabled}
                                  type="button"
                                  onClick={() =>
                                    handleRemoveTileImage(
                                      category.draftId,
                                      tile.draftId,
                                    )
                                  }
                                >
                                  {messages.removeTileImage}
                                </button>
                              ) : null}

                              <div className="sales-presentation-order-btns">
                                <button
                                  aria-label={`${messages.moveTileUp}: ${tile.displayName ?? tile.productId}`}
                                  className="sales-presentation-btn-icon"
                                  disabled={editingDisabled || tileIndex === 0}
                                  title={messages.moveTileUp}
                                  type="button"
                                  onClick={() =>
                                    handleMoveTile(catIndex, tileIndex, -1)
                                  }
                                >
                                  ↑
                                </button>
                                <button
                                  aria-label={`${messages.moveTileDown}: ${tile.displayName ?? tile.productId}`}
                                  className="sales-presentation-btn-icon"
                                  disabled={
                                    editingDisabled ||
                                    tileIndex === category.tiles.length - 1
                                  }
                                  title={messages.moveTileDown}
                                  type="button"
                                  onClick={() =>
                                    handleMoveTile(catIndex, tileIndex, 1)
                                  }
                                >
                                  ↓
                                </button>
                                <button
                                  aria-label={`${messages.removeTile}: ${tile.displayName ?? tile.productId}`}
                                  className="sales-presentation-btn-icon sales-presentation-btn-danger"
                                  disabled={editingDisabled}
                                  title={messages.removeTile}
                                  type="button"
                                  onClick={() =>
                                    handleRemoveTile(
                                      category.draftId,
                                      tile.draftId,
                                    )
                                  }
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </section>
            ) : null}
          </div>
          {/* Footer with action buttons */}
          <footer className="sales-presentation-footer">
            <button
              className="sales-presentation-cancel-btn"
              disabled={editingDisabled}
              type="button"
              onClick={onClose}
            >
              {messages.cancelButton}
            </button>
            <button
              className="sales-presentation-save-btn"
              disabled={busy || pendingImageTileIds.size > 0}
              type="submit"
            >
              {busy
                ? messages.savingSettingsButton
                : messages.saveSettingsButton}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
