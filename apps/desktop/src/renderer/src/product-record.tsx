import type { Product } from "@breev/contracts/local-rest";
import { useId, useState } from "react";

import {
  archiveProduct,
  CatalogApiDenied,
  mergeProduct,
  newIdempotencyKey,
} from "./catalog-api";
import { catalogMessages } from "./catalog-messages";
import { usePreferences } from "./preferences-provider";

export interface ProductRecordProps {
  readonly baseUrl: string;
  readonly onArchiveSuccess?: (product: Product) => void;
  readonly onBack?: () => void;
  readonly onEdit?: (product: Product) => void;
  readonly onMergeSuccess?: (product: Product) => void;
  readonly product: Product;
}

export function ProductRecord({
  baseUrl,
  onArchiveSuccess,
  onBack,
  onEdit,
  onMergeSuccess,
  product,
}: ProductRecordProps): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = catalogMessages[locale];
  const mergeInputId = useId();

  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [survivorProductId, setSurvivorProductId] = useState("");
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isArchived = product.status === "archived";
  const isMerged = product.status === "merged";
  const canModify = !isArchived && !isMerged;

  const handleArchiveConfirm = async (): Promise<void> => {
    setBusy(true);
    setErrorBanner(null);
    try {
      const updated = await archiveProduct(baseUrl, product.id, {
        expectedRevision: product.revision,
        idempotencyKey: newIdempotencyKey(),
      });
      setShowArchiveDialog(false);
      onArchiveSuccess?.(updated);
    } catch (error) {
      if (error instanceof CatalogApiDenied) {
        setErrorBanner(
          copy.denials[error.denial.code] ??
            `Error (${error.denial.code}): ${error.message}`,
        );
      } else if (error instanceof Error) {
        setErrorBanner(error.message);
      }
      setShowArchiveDialog(false);
    } finally {
      setBusy(false);
    }
  };

  const handleMergeConfirm = async (): Promise<void> => {
    const trimmedSurvivor = survivorProductId.trim();
    if (!trimmedSurvivor) {
      setMergeError(copy.fieldErrors.required);
      return;
    }

    setBusy(true);
    setMergeError(null);
    setErrorBanner(null);
    try {
      const updated = await mergeProduct(baseUrl, product.id, {
        expectedRevision: product.revision,
        idempotencyKey: newIdempotencyKey(),
        survivorProductId: trimmedSurvivor,
      });
      setShowMergeDialog(false);
      setSurvivorProductId("");
      onMergeSuccess?.(updated);
    } catch (error) {
      if (error instanceof CatalogApiDenied) {
        setMergeError(
          copy.denials[error.denial.code] ??
            `Error (${error.denial.code}): ${error.message}`,
        );
      } else if (error instanceof Error) {
        setMergeError(error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="identity-region" aria-label={copy.record.title}>
      {/* Error Banner */}
      {errorBanner !== null ? (
        <div aria-live="polite" className="denial-alert mb-4" role="alert">
          <span className="denial-icon" aria-hidden="true">
            !
          </span>
          <div>
            <strong>{copy.denials["product-not-found"]}</strong>
            <p>{errorBanner}</p>
          </div>
          <button
            aria-label="Dismiss error"
            className="dismiss-button"
            type="button"
            onClick={() => setErrorBanner(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      <article className="identity-card p-5 max-w-4xl w-full mx-auto space-y-5 animate-reveal">
        {/* Record Header */}
        <header className="border-b border-[color:var(--border)] pb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h2
                  className="text-2xl font-bold font-mono tracking-tight"
                  data-testid="product-display-name"
                >
                  {product.displayName}
                </h2>
                <span
                  className="state-chip"
                  data-status={product.status}
                  data-testid="product-status-chip"
                >
                  {copy.record.statuses[product.status]}
                </span>
              </div>

              {/* Arabic Search Name - directly below English name */}
              {product.arabicSearchName ? (
                <p
                  className="text-base mt-1"
                  data-testid="product-arabic-search-name"
                  dir="rtl"
                >
                  {product.arabicSearchName}
                </p>
              ) : null}
            </div>

            {/* Action buttons (No Delete action!) */}
            <div className="flex flex-wrap gap-2">
              {onBack ? (
                <button className="quiet-button" type="button" onClick={onBack}>
                  {copy.list.title}
                </button>
              ) : null}

              {canModify && onEdit ? (
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => onEdit(product)}
                >
                  {copy.actions.edit}
                </button>
              ) : null}

              {canModify ? (
                <>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => setShowArchiveDialog(true)}
                  >
                    {copy.actions.archive}
                  </button>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => setShowMergeDialog(true)}
                  >
                    {copy.actions.merge}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </header>

        {/* Master Data Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Identity & Technical Facts */}
          <section
            aria-labelledby="technical-facts-heading"
            className="space-y-2 p-3 rounded-lg border border-[color:var(--border)]"
          >
            <h3
              id="technical-facts-heading"
              className="text-xs font-bold uppercase tracking-widest text-muted-foreground"
            >
              {copy.record.title}
            </h3>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">{copy.record.id}:</dt>
              <dd className="font-mono text-xs break-all">{product.id}</dd>

              <dt className="text-muted-foreground">{copy.record.revision}:</dt>
              <dd className="font-mono">{product.revision}</dd>

              <dt className="text-muted-foreground">
                {copy.record.nameTemplateVersion}:
              </dt>
              <dd className="font-mono">{product.nameTemplateVersion}</dd>

              {product.mergedIntoProductId ? (
                <>
                  <dt className="text-muted-foreground">
                    {copy.record.mergedInto}:
                  </dt>
                  <dd className="font-mono text-xs break-all merged-into-value">
                    {product.mergedIntoProductId}
                  </dd>
                </>
              ) : null}
            </dl>
          </section>

          {/* Read-Only Inventory Balance Section */}
          <section
            aria-label={copy.inventory.readOnlyAssistiveText}
            className="space-y-2 p-3 rounded-lg border border-[color:var(--border)]"
            role="region"
          >
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {copy.inventory.title}
            </h3>
            <div className="space-y-2">
              <div
                aria-label={copy.inventory.title}
                aria-readonly="true"
                className="text-sm italic"
                data-testid="inventory-balance-readonly"
                role="textbox"
                tabIndex={0}
              >
                {copy.inventory.emptyState}
              </div>
              <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded border border-[color:var(--control-border)]">
                {copy.inventory.readOnlyAssistiveText}
              </span>
            </div>
          </section>
        </div>

        {/* Definition Breakdown */}
        <section
          aria-labelledby="definition-breakdown-heading"
          className="space-y-4"
        >
          <h3
            id="definition-breakdown-heading"
            className="text-base font-bold border-b border-[color:var(--border)] pb-2"
          >
            {copy.definition.modeLabel}:{" "}
            <span className="font-semibold text-primary">
              {copy.definition.modes[product.definition.mode]}
            </span>
          </h3>

          {product.definition.mode === "medication" ? (
            <dl className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-sm p-3 rounded-lg border border-[color:var(--border)]">
              <div>
                <dt className="text-muted-foreground">
                  {copy.definition.medication.tradeName}
                </dt>
                <dd className="font-semibold">
                  {product.definition.fields.tradeName}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {copy.definition.medication.strength}
                </dt>
                <dd className="font-semibold">
                  {product.definition.fields.strength || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {copy.definition.medication.dosageForm}
                </dt>
                <dd className="font-semibold">
                  {product.definition.fields.dosageForm || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {copy.definition.medication.manufacturer}
                </dt>
                <dd className="font-semibold">
                  {product.definition.fields.manufacturer || "—"}
                </dd>
              </div>
            </dl>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm p-3 rounded-lg border border-[color:var(--border)]">
              <div>
                <dt className="text-muted-foreground">
                  {copy.definition.generalItem.company}
                </dt>
                <dd className="font-semibold">
                  {product.definition.fields.company}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {copy.definition.generalItem.subBrand}
                </dt>
                <dd className="font-semibold">
                  {product.definition.fields.subBrand || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {copy.definition.generalItem.typeOfUse}
                </dt>
                <dd className="font-semibold">
                  {product.definition.fields.typeOfUse || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {copy.definition.generalItem.property}
                </dt>
                <dd className="font-semibold">
                  {product.definition.fields.property || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {copy.definition.generalItem.targetAudience}
                </dt>
                <dd className="font-semibold">
                  {product.definition.fields.targetAudience || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {copy.definition.generalItem.size}
                </dt>
                <dd className="font-semibold">
                  {product.definition.fields.size || "—"}
                </dd>
              </div>
            </dl>
          )}
        </section>

        {/* Supporting & Commercial Fields */}
        <section
          aria-labelledby="supporting-fields-heading"
          className="space-y-4"
        >
          <h3
            id="supporting-fields-heading"
            className="text-base font-bold border-b border-[color:var(--border)] pb-2"
          >
            {copy.fields.category} &amp; {copy.barcodes.label}
          </h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">
                {copy.fields.scientificName}
              </dt>
              <dd className="font-medium">{product.scientificName || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.fields.category}</dt>
              <dd className="font-medium">{product.category || "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground mb-1">
                {copy.barcodes.label}
              </dt>
              <dd>
                {product.barcodes.length === 0 ? (
                  <span className="text-muted-foreground italic">
                    {copy.barcodes.empty}
                  </span>
                ) : (
                  <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                    {product.barcodes.map((bc) => (
                      <li
                        key={bc}
                        className="px-2.5 py-1 rounded border border-[color:var(--control-border)] font-mono text-xs"
                      >
                        {bc}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
        </section>

        {/* Item Instructions */}
        <section aria-labelledby="instructions-heading" className="space-y-3">
          <h3
            id="instructions-heading"
            className="text-base font-bold border-b border-[color:var(--border)] pb-2"
          >
            {copy.instructions.title}
          </h3>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm p-3 rounded-lg border border-[color:var(--border)]">
            <div>
              <dt className="text-muted-foreground">
                {copy.instructions.usesPerDay}
              </dt>
              <dd className="font-semibold">
                {product.instructions.usesPerDay ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {copy.instructions.usesPerWeek}
              </dt>
              <dd className="font-semibold">
                {product.instructions.usesPerWeek ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {copy.instructions.usesPerMonth}
              </dt>
              <dd className="font-semibold">
                {product.instructions.usesPerMonth ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {copy.instructions.foodTiming}
              </dt>
              <dd className="font-semibold">
                {product.instructions.foodTiming
                  ? copy.instructions.foodTimings[
                      product.instructions.foodTiming
                    ]
                  : "—"}
              </dd>
            </div>
          </dl>
        </section>

        {/* Sharing & State Indicators */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section aria-labelledby="sharing-heading" className="space-y-2">
            <h3
              id="sharing-heading"
              className="text-base font-bold border-b border-[color:var(--border)] pb-2"
            >
              {copy.sharing.title}
            </h3>
            <p className="field-note">{copy.sharing.metadataNotice}</p>
            <ul className="space-y-1 text-sm list-none p-0">
              <li>
                <strong>{copy.sharing.externallyVisible}:</strong>{" "}
                {product.sharing.externallyVisible ? "✓" : "✗"}
              </li>
              <li>
                <strong>{copy.sharing.aiSharingAllowed}:</strong>{" "}
                {product.sharing.aiSharingAllowed ? "✓" : "✗"}
              </li>
            </ul>
          </section>

          <section
            aria-labelledby="state-indicators-heading"
            className="space-y-2"
          >
            <h3
              id="state-indicators-heading"
              className="text-base font-bold border-b border-[color:var(--border)] pb-2"
            >
              {copy.stateColours.title}
            </h3>
            <ul className="space-y-1 text-sm list-none p-0">
              <li>
                <strong>{copy.stateColours.manualColor}:</strong>{" "}
                {product.stateColours.manual
                  ? copy.stateColours.colors[product.stateColours.manual]
                  : copy.stateColours.manualColorNone}
              </li>
              <li>
                <strong>{copy.stateColours.coldStorageRequired}:</strong>{" "}
                {product.stateColours.coldStorageRequired ? "✓" : "✗"}
              </li>
            </ul>
          </section>
        </div>
      </article>

      {/* Archive Confirmation Dialog */}
      {showArchiveDialog ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setShowArchiveDialog(false);
            }
          }}
        >
          <div
            aria-describedby="archive-warning-text"
            aria-labelledby="archive-dialog-title"
            aria-modal="true"
            className="identity-card step-up-dialog"
            role="dialog"
          >
            <h3 id="archive-dialog-title">
              {copy.actions.archiveConfirmTitle}
            </h3>
            <p id="archive-warning-text" className="my-3 text-sm">
              {copy.actions.archiveConfirmWarning}
            </p>
            <div className="form-actions mt-4 flex justify-end gap-2">
              <button
                className="quiet-button"
                disabled={busy}
                type="button"
                onClick={() => setShowArchiveDialog(false)}
              >
                {copy.actions.cancel}
              </button>
              <button
                className="primary-button"
                disabled={busy}
                type="button"
                onClick={handleArchiveConfirm}
              >
                {busy ? "..." : copy.actions.archiveConfirmSubmit}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Merge Dialog */}
      {showMergeDialog ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setShowMergeDialog(false);
            }
          }}
        >
          <div
            aria-describedby="merge-dialog-description"
            aria-labelledby="merge-dialog-title"
            aria-modal="true"
            className="identity-card step-up-dialog"
            role="dialog"
          >
            <h3 id="merge-dialog-title">{copy.actions.mergeTitle}</h3>
            <p
              id="merge-dialog-description"
              className="my-2 text-sm text-muted-foreground"
            >
              {copy.actions.mergeDescription}
            </p>

            {mergeError ? (
              <p className="field-error mb-3" role="alert">
                {mergeError}
              </p>
            ) : null}

            <div className="field-label my-3">
              <label htmlFor={mergeInputId}>
                <span>{copy.fields.survivorProductId}</span>
              </label>
              <input
                id={mergeInputId}
                aria-describedby={mergeError ? "merge-input-error" : undefined}
                aria-invalid={Boolean(mergeError)}
                aria-required="true"
                className="font-mono text-sm"
                maxLength={64}
                name="survivorProductId"
                placeholder={copy.fields.survivorProductPlaceholder}
                type="text"
                value={survivorProductId}
                onChange={(e) => setSurvivorProductId(e.target.value)}
              />
            </div>

            <div className="form-actions mt-4 flex justify-end gap-2">
              <button
                className="quiet-button"
                disabled={busy}
                type="button"
                onClick={() => {
                  setShowMergeDialog(false);
                  setMergeError(null);
                }}
              >
                {copy.actions.cancel}
              </button>
              <button
                className="primary-button"
                disabled={busy}
                type="button"
                onClick={handleMergeConfirm}
              >
                {busy ? "..." : copy.actions.mergeConfirmSubmit}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
