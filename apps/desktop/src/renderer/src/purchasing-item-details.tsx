import { useEffect, useState } from "react";
import type { PurchaseItemDetails } from "@breev/contracts/local-rest";
import type { PurchaseItemSelection } from "./purchase-item-details";
import {
  requestPurchaseItemDetails,
  PurchasingApiDenied,
} from "./purchasing-api";
import { IdentityApiDenied } from "./identity-api";
import { useIdentityState } from "./identity-state-provider";
import { purchasingMessages } from "./purchasing-messages";
import { inventoryMessages } from "./inventory-messages";
import { usePreferences } from "./preferences-provider";
import { formatNumber, formatCurrencyFromFils } from "./preferences";
import { panelUnitLabel } from "./panel-unit-label";
import { MoneyAmount } from "./money-amount";
import "./purchasing-item-details.css";

type PanelRead = {
  readonly key: string;
  readonly details: PurchaseItemDetails | null;
  readonly status: "loading" | "ready" | "error" | "denied";
};

/** Purchasing-only live projection. Inventory's existing surface remains independent. */
export function PurchasingItemPanel({
  baseUrl,
  hidden,
  selection,
}: {
  readonly baseUrl: string;
  readonly hidden: boolean;
  readonly selection: PurchaseItemSelection | null;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const { state: identity } = useIdentityState();
  const [collapsedId, setCollapsedId] = useState<string | null>(null);
  const [expandedEmpty, setExpandedEmpty] = useState(false);
  const [retry, setRetry] = useState(0);
  const [read, setRead] = useState<PanelRead | null>(null);
  const productId = selection?.product.id ?? null;
  const permissions =
    identity?.state === "authenticated"
      ? identity.allowedPermissions.join(",")
      : "";
  // The fields array changes with saved entry preferences, including cost-column
  // settings. It stays stable through quantity/expiry keystrokes.
  const preferenceFields = selection?.fields;
  const key = JSON.stringify([
    baseUrl,
    productId,
    identity?.state === "authenticated" ? identity.pharmacy.id : null,
    identity?.state === "authenticated" ? identity.user.id : null,
    identity?.state === "authenticated" ? identity.session.id : null,
    permissions,
    selection?.preferencesRevision,
    retry,
  ]);
  useEffect(() => {
    if (hidden || productId === null || baseUrl === "") {
      setRead(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setRead({ key, details: null, status: "loading" });
    void requestPurchaseItemDetails(baseUrl, productId, controller.signal)
      .then((details) => {
        if (!active) return;
        if (details.productId !== productId)
          throw new Error("The panel response belongs to another Product");
        setRead({ key, details, status: "ready" });
      })
      .catch((error) => {
        if (!active) return;
        const denied =
          error instanceof IdentityApiDenied ||
          (error instanceof PurchasingApiDenied && error.statusCode === 403);
        setRead({ key, details: null, status: denied ? "denied" : "error" });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [baseUrl, hidden, key, preferenceFields, productId]);
  const current = read?.key === key ? read : null;
  const collapsed =
    productId === null ? !expandedEmpty : collapsedId === productId;
  return (
    <>
      {!hidden && collapsed ? (
        <button
          type="button"
          className="purchase-item-toggle-btn"
          aria-label={copy.showItemDetails}
          onClick={() => {
            setCollapsedId(null);
            setExpandedEmpty(true);
          }}
        >
          <span className="purchase-item-toggle-icon" aria-hidden="true">
            ℹ
          </span>
          <span>{copy.itemInfoBar}</span>
        </button>
      ) : null}
      <aside
        className="purchase-item-sidebar purchase-item-panel purchasing-authoritative-panel"
        aria-labelledby="purchase-item-panel-title"
        hidden={hidden}
        data-collapsed={collapsed ? "true" : undefined}
        tabIndex={-1}
        inert={collapsed}
      >
        <div className="purchase-item-sidebar-header">
          <div className="purchase-item-header-title-wrap">
            <span className="purchase-item-header-dot" aria-hidden="true" />
            <h2 id="purchase-item-panel-title">{copy.itemInfoBar}</h2>
          </div>
          <button
            type="button"
            className="quiet-button purchase-item-collapse-btn"
            aria-label={copy.collapseItemDetails}
            onClick={() => {
              setCollapsedId(productId);
              setExpandedEmpty(false);
            }}
          >
            ✕
          </button>
        </div>
        {selection === null ? (
          <div className="purchase-item-empty">
            <div className="purchase-item-empty-icon-box">
              <span className="purchase-item-empty-dot" />
            </div>
            <p>{copy.noSelectedItem}</p>
          </div>
        ) : (
          <div
            className="purchase-item-body"
            tabIndex={0}
            aria-busy={
              baseUrl !== "" &&
              (current?.status === "loading" || current === null)
            }
          >
            <div className="purchase-item-names-block">
              <div className="purchase-item-top-row">
                {current?.details?.visibleFields.includes("scientific-name") ? (
                  <p
                    className="purchase-item-scientific-name"
                    data-panel-field="scientific-name"
                  >
                    {current.details.scientificName ?? copy.panelMissing}
                  </p>
                ) : null}
                <span className="purchase-item-barcode">
                  {current?.details?.barcode ?? copy.noBarcode}
                </span>
              </div>
              <p className="purchase-item-trade-name">
                {current?.details?.displayName ?? selection.product.displayName}
              </p>
            </div>
            {current?.status === "ready" && current.details !== null ? (
              <PurchaseItemDetailsBody details={current.details} />
            ) : (
              <div className="purchase-item-empty">
                <p
                  role={
                    current?.status === "error" || current?.status === "denied"
                      ? "alert"
                      : "status"
                  }
                >
                  {baseUrl === ""
                    ? copy.panelOffline
                    : current?.status === "error"
                      ? copy.panelUnavailable
                      : current?.status === "denied"
                        ? copy.panelDenied
                        : copy.panelLoading}
                </p>
                {current?.status === "error" || current?.status === "denied" ? (
                  <button
                    type="button"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    {copy.retry}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}

/** Presentation only: conversion, expiry and risk were calculated by the server. */
export function PurchaseItemDetailsBody({
  details,
}: {
  readonly details: PurchaseItemDetails;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const stock = details.inventory;
  const statusCopy = inventoryMessages[locale];
  const number = (value: string) => formatNumber(BigInt(value), locale);
  const unit = (name: string, quantity: string) =>
    panelUnitLabel(name, BigInt(quantity), locale);
  const amount = (value: string | null) =>
    value === null ? (
      copy.panelMissing
    ) : (
      <MoneyAmount
        locale={locale}
        value={formatCurrencyFromFils(BigInt(value), locale)}
      />
    );
  const fact = (name: string, label: string, value: React.ReactNode) => (
    <div className="purchase-fact-row" data-panel-field={name}>
      <span className="purchase-fact-label">{label}</span>
      <span className="purchase-fact-value">{value}</span>
    </div>
  );
  const stockUnit = details.packaging.inventoryUnitName;
  const earliest = stock?.batches.find(
    (batch) => batch.effectiveExpiryDate !== null,
  );
  return (
    <>
      <hr className="purchase-item-divider" />
      <div className="purchase-item-section" data-panel-field="balance">
        <p className="purchase-item-section-title">{copy.detailedBalance}</p>
        {stock === null ? (
          <p role="status">{copy.panelDeniedStock}</p>
        ) : (
          <>
            <div
              className={`purchase-fraction-grid ${stock.breakdown.length === 2 ? "is-two-unit" : ""}`}
            >
              {stock.breakdown.map((item) => (
                <div className="purchase-fraction-cell" key={item.name}>
                  <p className="purchase-fraction-num">
                    <bdi>{number(item.quantity)}</bdi>
                  </p>
                  <p className="purchase-fraction-label">
                    {unit(item.name, item.quantity)}
                  </p>
                </div>
              ))}
            </div>
            <p className="purchase-balance-total-text">
              {copy.totalDetailed} : <bdi>{number(stock.balance)}</bdi>{" "}
              {unit(stockUnit, stock.balance)}
            </p>
          </>
        )}
      </div>
      <div className="purchase-fact-card">
        {details.visibleFields.includes("packaging")
          ? fact(
              "packaging",
              copy.packaging,
              <>
                {details.packaging.packageUnits.map((item) => (
                  <span
                    className="purchase-panel-package-equation"
                    key={item.name}
                  >
                    {number("1")} {unit(item.name, "1")} ={" "}
                    {number(item.baseUnitsPerPackage)}{" "}
                    {unit(stockUnit, item.baseUnitsPerPackage)}
                  </span>
                ))}
                {details.packaging.packageUnits.length === 0 ? stockUnit : null}
              </>,
            )
          : null}
        {fact(
          "stock-limits",
          copy.stockLimits,
          stock === null ? (
            copy.panelHidden
          ) : (
            <>
              <span title={copy.minStock}>
                ↓{" "}
                {stock.minimumLevel === null
                  ? copy.panelMissing
                  : number(stock.minimumLevel)}
              </span>
              {" · "}
              <span title={copy.maxStock}>
                ↑{" "}
                {stock.maximumLevel === null
                  ? copy.panelMissing
                  : number(stock.maximumLevel)}
              </span>{" "}
              {unit(stockUnit, "1")}
            </>
          ),
        )}
        {details.visibleFields.includes("wholesale-price")
          ? fact(
              "wholesale-price",
              copy.wholesalePrice,
              amount(details.wholesalePriceFils),
            )
          : null}
        {fact(
          "consumption",
          copy.consumptionRate,
          copy.panelReportingUnavailable,
        )}
        {fact(
          "days-of-supply",
          copy.daysOfSupply,
          copy.panelReportingUnavailable,
        )}
        {fact(
          "expiry",
          copy.expiry,
          stock === null ? (
            copy.panelHidden
          ) : earliest === undefined ? (
            copy.noExpiry
          ) : (
            <span className="purchase-expiry-details">
              <bdi>{earliest.effectiveExpiryDate}</bdi>
              <span
                className={`purchase-expiry-badge ${earliest.status === "expired" ? "is-expired" : earliest.status === "near-expiry" ? "is-soon" : "is-ok"}`}
              >
                <bdi>{earliest.daysRemaining}</bdi> {copy.panelDaysRelative}
              </span>
            </span>
          ),
        )}
        {details.visibleFields.includes("category")
          ? fact(
              "category",
              copy.category,
              details.category ?? copy.panelMissing,
            )
          : null}
        {fact(
          "pricing-mode",
          copy.pricingMethod,
          details.pricingMethod === "by-price"
            ? copy.byPrice
            : copy.byPercentage,
        )}
        {fact(
          "retail-price",
          copy.panelCurrentRetail,
          amount(details.retailPriceFils),
        )}
        {fact(
          "average-cost",
          copy.panelAverageCost,
          details.averageCostVisibility === "visible" ? (
            <>
              {amount(details.averageUnitCostFils)} / {unit(stockUnit, "1")}
            </>
          ) : (
            copy.panelHidden
          ),
        )}
        {fact(
          "estimated-surplus",
          copy.panelSurplus,
          copy.panelReportingUnavailable,
        )}
      </div>
      <div className="purchase-item-section" data-panel-field="alerts">
        <p className="purchase-item-section-title">{copy.panelAlerts}</p>
        <p role="status">
          {stock === null
            ? copy.panelHidden
            : stock.alerts.length === 0
              ? copy.panelNoAlerts
              : stock.alerts
                  .map((alert) => statusCopy.riskIndicators[alert])
                  .join(" · ")}
        </p>
        {stock?.reconciliation === "mismatch" ? (
          <p role="alert">{copy.panelMismatch}</p>
        ) : null}
        <p className="purchase-balance-total-text">
          {copy.panelAsOf} <bdi>{details.businessDate}</bdi>
        </p>
      </div>
      <div className="purchase-item-section" data-panel-field="batches">
        <p className="purchase-item-section-title">{copy.panelBatches}</p>
        {stock === null ? (
          <p>{copy.panelHidden}</p>
        ) : stock.batches.length === 0 ? (
          <p>{copy.panelNoBatches}</p>
        ) : (
          stock.batches.map((batch) => (
            <div
              className="purchase-fact-card purchase-panel-batch"
              key={batch.id}
            >
              {fact("lot", copy.panelLot, batch.lotNumber ?? copy.panelMissing)}
              {fact(
                "batch-balance",
                copy.detailedBalance,
                <>
                  <bdi>{number(batch.balance)}</bdi>{" "}
                  {unit(stockUnit, batch.balance)}
                </>,
              )}
              {fact(
                "batch-expiry",
                copy.expiry,
                <>
                  <bdi>{batch.effectiveExpiryDate ?? copy.noExpiry}</bdi>
                  {batch.daysRemaining === null ? null : (
                    <>
                      {" "}
                      · <bdi>{batch.daysRemaining}</bdi>{" "}
                      {copy.panelDaysRelative}
                    </>
                  )}
                </>,
              )}
              {batch.originalExpiryDate !== batch.effectiveExpiryDate
                ? fact(
                    "original-expiry",
                    copy.panelOriginalExpiry,
                    batch.originalExpiryDate ?? copy.noExpiry,
                  )
                : null}
              {fact(
                "batch-status",
                copy.panelStatus,
                statusCopy.safety.statusLabels[batch.status],
              )}
            </div>
          ))
        )}
      </div>
      <div className="purchase-item-section" data-panel-field="frozen-cost">
        <p className="purchase-item-section-title">{copy.panelLastPurchase}</p>
        {details.costVisibility !== "visible" ? (
          <p>{copy.panelHidden}</p>
        ) : details.lastPostedCost === null ? (
          <p>{copy.panelNoPurchase}</p>
        ) : (
          <div className="purchase-fact-card">
            {fact(
              "reference-date",
              copy.invoiceDate,
              details.lastPostedCost.invoiceDate,
            )}
            {fact(
              "reference-quantity",
              copy.enteredQuantity,
              <>
                {number(details.lastPostedCost.enteredQuantity)}{" "}
                {unit(
                  details.lastPostedCost.enteredUnitName,
                  details.lastPostedCost.enteredQuantity,
                )}
              </>,
            )}
            {fact(
              "reference-primary",
              copy.primarySupplierCost,
              amount(details.lastPostedCost.primarySupplierCostFils),
            )}
            {fact(
              "reference-discounted",
              copy.costAfterDiscount,
              amount(details.lastPostedCost.costAfterDiscountFils),
            )}
          </div>
        )}
      </div>
    </>
  );
}
