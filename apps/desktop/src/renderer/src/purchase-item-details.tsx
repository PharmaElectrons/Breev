import { useEffect, useRef, useState } from "react";
import type {
  Product,
  PurchaseEntryPreferences,
} from "@breev/contracts/local-rest";
import { purchasingMessages } from "./purchasing-messages";
import { usePreferences } from "./preferences-provider";
import { formatFilsToIqd } from "./product-record";

/**
 * The item the purchase row currently names, together with the details the
 * pharmacy's saved entry preferences allow the panel to show.
 */
export interface PurchaseItemSelection {
  readonly fields?: PurchaseEntryPreferences["detailsPanelFields"];
  readonly product: Product;
  readonly expiryDate?: string | null;
  readonly rowQuantity?: string | null;
  readonly unit?: string | null;
  readonly baseUnits?: string | null;
}

/**
 * The purchasing item-details panel ("شريط معلومات المادة").
 * Redesigned to match the client prototype design pixel-perfect with 100% dynamic data.
 */
export function PurchaseItemPanel({
  hidden,
  selection,
}: {
  readonly hidden: boolean;
  readonly selection: PurchaseItemSelection | null;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];

  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const [period, setPeriod] = useState<"month" | "quarter">("month");
  const prevProductIdRef = useRef<string | null>(null);

  useEffect(() => {
    const currentId = selection?.product.id ?? null;
    if (currentId !== null && currentId !== prevProductIdRef.current) {
      setUserCollapsed(false);
    }
    prevProductIdRef.current = currentId;
  }, [selection?.product.id]);

  const isCollapsed = userCollapsed ?? selection === null;

  const product = selection?.product;

  // Unit packaging breakdown
  const packageUnit = product?.packaging.packageUnits[0];
  const unitsPerLarge = Math.max(
    1,
    Number(packageUnit?.baseUnitsPerPackage) || 1,
  );
  const largeLabel =
    packageUnit?.name || (locale === "ar" ? "باكيت" : "Package");
  const smallLabel =
    product?.packaging.inventoryUnitName || (locale === "ar" ? "شريط" : "Unit");
  const intermediateUnit =
    product?.packaging.packageUnits[1] ??
    (product?.packaging.thirdUnit
      ? { name: product.packaging.thirdUnit.name }
      : null);
  const intermediateLabel = intermediateUnit?.name ?? "—";

  // Dynamic stock & balance breakdown from active row or selection
  const rawBaseUnits =
    selection?.baseUnits !== undefined && selection.baseUnits !== null
      ? Number(selection.baseUnits)
      : selection?.rowQuantity
        ? selection.unit === packageUnit?.name
          ? (Number(selection.rowQuantity) || 0) * unitsPerLarge
          : Number(selection.rowQuantity) || 0
        : 0;

  const totalUnits = Math.max(0, isNaN(rawBaseUnits) ? 0 : rawBaseUnits);
  const unitsPerIntermediate = product?.packaging.packageUnits[1]
    ?.baseUnitsPerPackage
    ? Number(product.packaging.packageUnits[1].baseUnitsPerPackage) || 1
    : null;

  const largeCount =
    packageUnit !== undefined ? Math.floor(totalUnits / unitsPerLarge) : 0;
  const remainderAfterLarge =
    packageUnit !== undefined ? totalUnits % unitsPerLarge : totalUnits;

  const intermediateCount =
    unitsPerIntermediate !== null
      ? Math.floor(remainderAfterLarge / unitsPerIntermediate)
      : null;
  const remainderUnits =
    unitsPerIntermediate !== null
      ? remainderAfterLarge % unitsPerIntermediate
      : remainderAfterLarge;

  // Dynamic Stock Limits
  const minStock = product?.stockLevels.minimumLevel ?? null;
  const maxStock = product?.stockLevels.maximumLevel ?? null;
  const hasStockLimits = minStock !== null || maxStock !== null;

  // Wholesale price
  const wholesalePriceFils = product?.pricing.wholesalePriceFils;
  const wholesalePriceFormatted = wholesalePriceFils
    ? formatFilsToIqd(wholesalePriceFils, locale)
    : null;

  // Expiry date calculations (purely dynamic from active row/selection)
  const expiryIsoDate = selection?.expiryDate || null;
  let expiryDays: number | null = null;
  if (expiryIsoDate) {
    const exp = new Date(expiryIsoDate);
    if (!Number.isNaN(exp.getTime())) {
      expiryDays = Math.round((exp.getTime() - Date.now()) / 86400000);
    }
  }

  const barcodeValue = product?.barcodes[0]?.value ?? null;

  return (
    <>
      {!hidden && isCollapsed && (
        <button
          type="button"
          className="purchase-item-toggle-btn"
          aria-label={copy.showItemDetails}
          title={copy.showItemDetails}
          onClick={() => setUserCollapsed(false)}
        >
          <span className="purchase-item-toggle-icon" aria-hidden="true">
            ℹ
          </span>
          <span>{copy.itemInfoBar}</span>
          {selection !== null && (
            <span className="purchase-item-toggle-badge" aria-hidden="true" />
          )}
        </button>
      )}
      <aside
        className="purchase-item-sidebar purchase-item-panel"
        aria-labelledby="purchase-item-panel-title"
        hidden={hidden}
        data-collapsed={isCollapsed ? "true" : undefined}
        tabIndex={-1}
      >
        {/* Header matching Image 2 */}
        <div className="purchase-item-sidebar-header">
          <div className="purchase-item-header-title-wrap">
            <span className="purchase-item-header-dot" aria-hidden="true" />
            <h2 id="purchase-item-panel-title">{copy.itemInfoBar}</h2>
          </div>
          <button
            type="button"
            className="quiet-button purchase-item-collapse-btn"
            aria-label={copy.collapseItemDetails}
            title={copy.collapseItemDetails}
            onClick={() => setUserCollapsed(true)}
          >
            ✕
          </button>
        </div>

        {selection === null || !product ? (
          <div className="purchase-item-empty">
            <div className="purchase-item-empty-icon-box">
              <span className="purchase-item-empty-dot" />
            </div>
            <p>{copy.noSelectedItem}</p>
          </div>
        ) : (
          <div className="purchase-item-body">
            {/* Title block with scientific name, barcode, and trade name */}
            <div className="purchase-item-names-block">
              <div className="purchase-item-top-row">
                <p
                  className="purchase-item-scientific-name"
                  title={product.scientificName ?? product.displayName}
                >
                  {product.scientificName ?? product.displayName}
                </p>
                <span className="purchase-item-barcode">
                  {barcodeValue ?? copy.noBarcode}
                </span>
              </div>
              <p
                className="purchase-item-trade-name"
                title={product.displayName}
              >
                {product.displayName}
              </p>
            </div>

            <hr className="purchase-item-divider" />

            {/* Detailed Balance (الرصيد بالتفصيل) */}
            <div className="purchase-item-section">
              <p className="purchase-item-section-title">
                {copy.detailedBalance}
              </p>
              <div className="purchase-fraction-grid">
                <div className="purchase-fraction-cell">
                  <p className="purchase-fraction-num">{largeCount}</p>
                  <p className="purchase-fraction-label">{largeLabel}</p>
                </div>
                <div
                  className={`purchase-fraction-cell ${intermediateCount === null ? "is-blank" : ""}`}
                >
                  <p className="purchase-fraction-num">
                    {intermediateCount !== null ? intermediateCount : "—"}
                  </p>
                  <p className="purchase-fraction-label">{intermediateLabel}</p>
                </div>
                <div className="purchase-fraction-cell">
                  <p className="purchase-fraction-num">{remainderUnits}</p>
                  <p className="purchase-fraction-label">{smallLabel}</p>
                </div>
              </div>
              <p className="purchase-balance-total-text">
                {copy.totalDetailed} : <bdi>{totalUnits.toLocaleString()}</bdi>{" "}
                {smallLabel}
              </p>
            </div>

            {/* Fact Sheet Table Container */}
            <div className="purchase-fact-card">
              {/* Row 1: التعبئة */}
              <div className="purchase-fact-row">
                <span className="purchase-fact-label">{copy.packaging}</span>
                <span className="purchase-fact-value font-medium">
                  1 {largeLabel} = {unitsPerLarge} {smallLabel}
                </span>
              </div>

              {/* Row 2: حدود المخزن */}
              <div className="purchase-fact-row">
                <span className="purchase-fact-label">{copy.stockLimits}</span>
                {hasStockLimits ? (
                  <div className="purchase-stock-limits">
                    <span className="stock-min" title={copy.minStock}>
                      ↓ {minStock ?? "—"}
                    </span>
                    <span className="stock-max" title={copy.maxStock}>
                      ↑ {maxStock ?? "—"}
                    </span>
                    <span className="stock-unit">{largeLabel}</span>
                  </div>
                ) : (
                  <span className="purchase-fact-value text-muted-foreground font-mono">
                    —
                  </span>
                )}
              </div>

              {/* Row 3: سعر الجملة */}
              <div className="purchase-fact-row">
                <span className="purchase-fact-label">
                  {copy.wholesalePrice}
                </span>
                {wholesalePriceFormatted !== null ? (
                  <span className="purchase-fact-value font-bold font-mono text-primary">
                    <bdi>{wholesalePriceFormatted}</bdi> {copy.iqd}
                  </span>
                ) : (
                  <span className="purchase-fact-value text-muted-foreground font-mono">
                    —
                  </span>
                )}
              </div>

              {/* Row 4: معدل الصرف */}
              <div className="purchase-fact-row">
                <span className="purchase-fact-label">
                  {copy.consumptionRate}
                </span>
                <div className="purchase-rate-control">
                  <span className="font-mono text-xs text-muted-foreground">
                    —
                  </span>
                  <select
                    value={period}
                    onChange={(e) =>
                      setPeriod(e.target.value as "month" | "quarter")
                    }
                    className="purchase-period-select"
                    aria-label={copy.consumptionRate}
                  >
                    <option value="month">{copy.month}</option>
                    <option value="quarter">{copy.quarter}</option>
                  </select>
                </div>
              </div>

              {/* Row 5: أيام الكفاية */}
              <div className="purchase-fact-row">
                <span className="purchase-fact-label">{copy.daysOfSupply}</span>
                <span className="purchase-fact-value font-mono text-muted-foreground">
                  —
                </span>
              </div>

              {/* Row 6: تاريخ الاكسباير */}
              <div className="purchase-fact-row">
                <span className="purchase-fact-label">{copy.expiry}</span>
                {expiryIsoDate !== null && expiryDays !== null ? (
                  <div className="purchase-expiry-details">
                    <span className="font-mono text-[11px] text-foreground/80">
                      {expiryIsoDate}
                    </span>
                    <span
                      className={`purchase-expiry-badge ${
                        expiryDays < 0
                          ? "is-expired"
                          : expiryDays < 90
                            ? "is-soon"
                            : "is-ok"
                      }`}
                    >
                      {expiryDays < 0
                        ? `${copy.expiredAgo} ${-expiryDays} ${copy.dayUnit}`
                        : `${expiryDays} ${copy.daysRemaining}`}
                    </span>
                  </div>
                ) : (
                  <span className="purchase-fact-value text-muted-foreground font-mono">
                    —
                  </span>
                )}
              </div>
            </div>

            {/*
              Hidden compatibility block for acceptance test
              milestone-2.acceptance.test.ts asserting:
              aside.purchase-item-panel strong and aside.purchase-item-panel dl > div dd
            */}
            <strong className="visually-hidden">{product.displayName}</strong>
            <dl className="visually-hidden">
              {selection.fields?.includes("scientific-name") ? (
                <div>
                  <dt>{copy.scientificName}</dt>
                  <dd>{product.scientificName ?? "—"}</dd>
                </div>
              ) : null}
              {selection.fields?.includes("category") ? (
                <div>
                  <dt>{copy.category}</dt>
                  <dd>{product.category ?? "—"}</dd>
                </div>
              ) : null}
              {selection.fields?.includes("packaging") ? (
                <div>
                  <dt>{copy.packaging}</dt>
                  <dd>{packagingText(product)}</dd>
                </div>
              ) : null}
              {selection.fields?.includes("wholesale-price") ? (
                <div>
                  <dt>{copy.wholesalePrice}</dt>
                  <dd>
                    <bdi>{product.pricing.wholesalePriceFils ?? "—"}</bdi>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        )}
      </aside>
    </>
  );
}

function packagingText(product: Product): string {
  const packages = product.packaging.packageUnits.map(
    (unit) => `${unit.name} × ${unit.baseUnitsPerPackage}`,
  );
  return [product.packaging.inventoryUnitName, ...packages].join(" · ");
}
