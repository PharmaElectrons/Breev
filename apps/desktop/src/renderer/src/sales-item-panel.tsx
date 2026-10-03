import type {
  SalePanelSettings,
  SaleProductContext,
} from "@breev/contracts/local-rest";
import type React from "react";

import {
  directionForLocale,
  formatCurrencyFromFils,
  formatNumber,
} from "./preferences";
import type { Locale } from "./preferences";
import { getSalesPanelMessages } from "./sales-panel-messages";

import "./sales-panel.css";

export interface SalesItemPanelProps {
  readonly context: SaleProductContext;
  readonly settings: SalePanelSettings;
  readonly locale: Locale;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function SalesItemPanel({
  context,
  settings,
  locale,
}: SalesItemPanelProps): React.JSX.Element {
  const messages = getSalesPanelMessages(locale);
  const dir = directionForLocale(locale);

  const isFieldVisible = (
    field: (typeof settings.visibleFields)[number],
  ): boolean => settings.visibleFields.includes(field);

  // Selected consumption average based on settings.consumptionMonths (1, 2, or 3)
  const consumptionAverageBaseUnits =
    settings.consumptionMonths === 1
      ? context.inventory.consumptionAverages.oneMonth
      : settings.consumptionMonths === 2
        ? context.inventory.consumptionAverages.twoMonths
        : context.inventory.consumptionAverages.threeMonths;

  // Earliest expiry computation across batches
  const batchesWithExpiry = context.inventory.batches
    .filter(
      (b): b is typeof b & { effectiveExpiryDate: string } =>
        b.effectiveExpiryDate !== null,
    )
    .sort((a, b) => a.effectiveExpiryDate.localeCompare(b.effectiveExpiryDate));
  const earliestBatch = batchesWithExpiry[0] ?? null;

  // Balance breakdown for package unit vs base unit if defined
  const onHandBase =
    context.inventory.onHandBaseUnits === null
      ? null
      : BigInt(context.inventory.onHandBaseUnits);
  const primaryPackage = context.packageUnits[0] ?? null;
  const packageUnitsPerPkg = primaryPackage
    ? BigInt(primaryPackage.baseUnitsPerPackage)
    : 0n;

  const packageCount =
    onHandBase !== null && packageUnitsPerPkg > 0n
      ? onHandBase / packageUnitsPerPkg
      : null;
  const remainderBaseCount =
    onHandBase !== null && packageUnitsPerPkg > 0n
      ? onHandBase % packageUnitsPerPkg
      : onHandBase;

  return (
    <section
      aria-label={messages.itemDetailsTitle}
      className="sales-item-panel"
      dir={dir}
    >
      <div
        aria-label={messages.itemDetailsTitle}
        className="sales-item-scroll-body"
        role="group"
        tabIndex={0}
      >
        {/* Compact integrated thumbnail when configured and present */}
        {isFieldVisible("thumbnail") && context.thumbnailDataUrl ? (
          <div className="sales-item-thumbnail-wrap">
            <img
              alt={context.displayName}
              className="sales-item-thumbnail-img"
              src={context.thumbnailDataUrl}
            />
          </div>
        ) : null}

        {/* Fact sheet rows: Current retail, wholesale, scientific name, packaging, limits, consumption, surplus, expiry */}
        <div className="sales-item-fact-sheet">
          {/* Retail price: Always kept */}
          <div className="sales-item-fact-row">
            <span className="sales-item-fact-label">
              {messages.currentPrice}
            </span>
            <span className="sales-item-fact-value sales-item-retail-price">
              {formatCurrencyFromFils(
                BigInt(context.currentRetailPriceFils),
                locale,
              )}
            </span>
          </div>

          {/* Wholesale price: Only when nonnull and field enabled */}
          {isFieldVisible("wholesalePrice") &&
          context.wholesalePriceFils !== null ? (
            <div className="sales-item-fact-row">
              <span className="sales-item-fact-label">
                {messages.wholesalePrice}
              </span>
              <span className="sales-item-fact-value sales-item-wholesale-price">
                {formatCurrencyFromFils(
                  BigInt(context.wholesalePriceFils),
                  locale,
                )}
              </span>
            </div>
          ) : null}

          {/* Scientific name */}
          {isFieldVisible("scientificName") ? (
            <div className="sales-item-fact-row">
              <span className="sales-item-fact-label">
                {messages.scientificName}
              </span>
              <span className="sales-item-fact-value sales-item-display-name">
                {context.scientificName ?? messages.notSet}
              </span>
            </div>
          ) : null}

          {/* Packaging */}
          {isFieldVisible("packaging") ? (
            <div className="sales-item-fact-row">
              <span className="sales-item-fact-label">
                {messages.packaging}
              </span>
              <span className="sales-item-fact-value">
                {context.packageUnits
                  .map(
                    (unit) =>
                      `1 ${unit.name} = ${formatNumber(BigInt(unit.baseUnitsPerPackage), locale)} ${context.inventoryUnitName}`,
                  )
                  .join(" · ") || context.inventoryUnitName}
              </span>
            </div>
          ) : null}

          {/* Stock Limits (Levels) */}
          {isFieldVisible("levels") ? (
            <div className="sales-item-fact-row">
              <span className="sales-item-fact-label">
                {messages.stockLimits}
              </span>
              <div className="sales-item-limits-wrap">
                <span
                  className="sales-item-limit-min"
                  title={messages.minLimit}
                >
                  ↓{" "}
                  {context.stockLevels.minimumLevel === null
                    ? messages.notSet
                    : formatNumber(
                        BigInt(context.stockLevels.minimumLevel),
                        locale,
                      )}
                </span>
                <span
                  className="sales-item-limit-max"
                  title={messages.maxLimit}
                >
                  ↑{" "}
                  {context.stockLevels.maximumLevel === null
                    ? messages.notSet
                    : formatNumber(
                        BigInt(context.stockLevels.maximumLevel),
                        locale,
                      )}
                </span>
                <span className="sales-item-fact-label">
                  {context.inventoryUnitName}
                </span>
              </div>
            </div>
          ) : null}

          {/* Consumption Rate */}
          {isFieldVisible("consumption") ? (
            <div className="sales-item-fact-row">
              <span className="sales-item-fact-label">
                {messages.consumptionRate}
              </span>
              <span className="sales-item-fact-value">
                {consumptionAverageBaseUnits === null
                  ? messages.noConsumptionHistory
                  : `${formatNumber(BigInt(consumptionAverageBaseUnits), locale)} ${context.inventoryUnitName} (${messages.consumptionPeriodLabel(settings.consumptionMonths)})`}
              </span>
            </div>
          ) : null}

          {/* Surplus */}
          {isFieldVisible("surplus") ? (
            <div className="sales-item-fact-row">
              <span className="sales-item-fact-label">
                {messages.estimatedSurplus}
              </span>
              <span className="sales-item-fact-value">
                {context.stockLevels.maximumLevel === null
                  ? messages.maximumNotSet
                  : context.inventory.estimatedSurplusBaseUnits === null
                    ? messages.noStockRecord
                    : `${formatNumber(BigInt(context.inventory.estimatedSurplusBaseUnits), locale)} ${context.inventoryUnitName}`}
              </span>
            </div>
          ) : null}

          {/* Expiry overview */}
          {isFieldVisible("expiry") ? (
            <div className="sales-item-fact-row">
              <span className="sales-item-fact-label">
                {messages.expiryDate}
              </span>
              <span className="sales-item-fact-value">
                {earliestBatch === null ? (
                  messages.noExpiryDate
                ) : (
                  <>
                    <span>{earliestBatch.effectiveExpiryDate}</span>
                    {earliestBatch.daysRemaining !== null ? (
                      <span>
                        {" "}
                        ·{" "}
                        {earliestBatch.daysRemaining < 0
                          ? messages.daysExpired(
                              Math.abs(earliestBatch.daysRemaining),
                            )
                          : messages.daysRemaining(earliestBatch.daysRemaining)}
                      </span>
                    ) : null}
                  </>
                )}
              </span>
            </div>
          ) : null}
        </div>

        {/* Balance breakdown if configured: dense label/value rows */}
        {isFieldVisible("balance") ? (
          <div className="sales-item-balance-section">
            {primaryPackage && packageCount !== null ? (
              <div className="sales-item-fact-row">
                <span className="sales-item-fact-label">
                  {messages.detailedBalance}
                </span>
                <span className="sales-item-fact-value">
                  {formatNumber(packageCount, locale)} {primaryPackage.name}
                  {remainderBaseCount !== null && remainderBaseCount > 0n
                    ? ` · ${formatNumber(remainderBaseCount, locale)} ${context.inventoryUnitName}`
                    : ""}
                </span>
              </div>
            ) : null}
            <div className="sales-item-fact-row">
              <span className="sales-item-fact-label">
                {primaryPackage && packageCount !== null
                  ? messages.totalBalance
                  : messages.balance}
              </span>
              <span className="sales-item-fact-value">
                {onHandBase === null
                  ? messages.noStockRecord
                  : `${formatNumber(onHandBase, locale)} ${context.inventoryUnitName}`}
              </span>
            </div>
          </div>
        ) : null}

        {/* Batches with lot ordinals, balances, statuses, and expiry */}
        {isFieldVisible("batches") ? (
          <section
            aria-label={messages.batchesHeading}
            className="sales-item-batches-section"
          >
            <h4 className="sales-item-section-label">
              {messages.batchesHeading}
            </h4>
            {context.inventory.batches.length === 0 ? (
              <p className="sales-item-empty-batches">
                {messages.noBatchesRecorded}
              </p>
            ) : (
              <ul className="sales-item-batches-list">
                {context.inventory.batches.map((batch, index) => {
                  const lot = batch.lotNumber?.trim();
                  const lotLabel =
                    lot && lot.length > 0 && !UUID_REGEX.test(lot)
                      ? lot
                      : messages.unlabeledBatchOrdinal(index + 1);

                  return (
                    <li className="sales-item-batch-card" key={batch.batchId}>
                      <div className="sales-item-batch-header">
                        <span className="sales-item-batch-ordinal">
                          {lotLabel}
                        </span>
                        <span className="sales-item-batch-balance">
                          {formatNumber(BigInt(batch.balanceBaseUnits), locale)}{" "}
                          {context.inventoryUnitName}
                        </span>
                      </div>
                      <div className="sales-item-batch-footer">
                        <span
                          className={`sales-item-batch-status-badge status-${batch.status}`}
                        >
                          {messages.batchStatus[batch.status] ?? batch.status}
                        </span>
                        <span>
                          {batch.effectiveExpiryDate ?? messages.noExpiryDate}
                          {batch.daysRemaining !== null ? (
                            <>
                              {" "}
                              ·{" "}
                              {batch.daysRemaining < 0
                                ? messages.daysExpired(
                                    Math.abs(batch.daysRemaining),
                                  )
                                : messages.daysRemaining(batch.daysRemaining)}
                            </>
                          ) : null}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        {/* Hidden EMPTY AI Recommendations structural slot per issue 62 contract */}
        <div
          aria-hidden="true"
          className="sales-item-ai-recommendations-slot"
          data-slot="ai-recommendations"
          style={{ display: "none" }}
        />
      </div>
    </section>
  );
}
