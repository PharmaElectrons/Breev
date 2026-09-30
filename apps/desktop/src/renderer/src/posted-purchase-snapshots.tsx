import type {
  PostedPurchaseAdjustment,
  PostedPurchaseReturn,
  PurchasePostedDetail,
} from "@breev/contracts/local-rest";
import { panelUnitLabel, unitQuantity } from "./panel-unit-label";
import {
  getAdjustmentReasonLabel,
  purchasingMessages,
} from "./purchasing-messages";
import { usePreferences } from "./preferences-provider";
import { formatFilsToIqd } from "./product-record";

export function PostedAdjustmentView({
  adjustment,
  onBack,
}: {
  readonly adjustment: PostedPurchaseAdjustment;
  readonly onBack: () => void;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  return (
    <article
      className="posted-adjustment-view"
      aria-labelledby="posted-adjustment-title"
    >
      <p className="purchase-context-label">{copy.historicalSnapshot}</p>
      <h3 id="posted-adjustment-title">
        {formatAdjustmentNumber(adjustment.number)}
      </h3>
      <p>
        {getAdjustmentReasonLabel(adjustment.reason, locale)} ·{" "}
        {formatTimestamp(adjustment.postedAt, locale)}
      </p>
      <dl className="posted-purchase-totals">
        <div>
          <dt>{copy.quantity}</dt>
          <dd>
            <bdi>{adjustment.quantityDelta}</bdi>
          </dd>
        </div>
        <div>
          <dt>{copy.primarySupplierCost}</dt>
          <dd>
            <bdi>{adjustment.primarySupplierCostDeltaFils}</bdi> {copy.fils}
          </dd>
        </div>
      </dl>
      <ul>
        {adjustment.rowDeltas.map((row) => (
          <li key={row.lineageId}>
            {row.after?.itemDisplayName ?? row.before?.itemDisplayName}:{" "}
            {row.before?.enteredQuantity ?? "0"} →{" "}
            {row.after?.enteredQuantity ?? "0"} ({row.quantityDelta})
          </li>
        ))}
      </ul>
      <div className="posted-correction-actions">
        <button type="button" className="quiet-button" onClick={onBack}>
          {copy.backToInvoice}
        </button>
      </div>
    </article>
  );
}

export function PostedReturnView({
  purchaseReturn,
  onBack,
}: {
  readonly purchaseReturn: PostedPurchaseReturn;
  readonly onBack: () => void;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  return (
    <article
      className="posted-return-view"
      aria-labelledby="posted-return-title"
    >
      <p className="purchase-context-label">{copy.returnStageTitle}</p>
      <h3 id="posted-return-title">
        {formatReturnNumber(purchaseReturn.number)}
      </h3>
      <p>
        {purchaseReturn.reason} ·{" "}
        {formatTimestamp(purchaseReturn.postedAt, locale)}
      </p>
      <p>{purchaseReturn.evidence}</p>
      <dl className="posted-purchase-totals">
        <div>
          <dt>{copy.returnCarryingAmount}</dt>
          <dd>
            <bdi>{purchaseReturn.inventoryCarryingAmountFils}</bdi> {copy.fils}
          </dd>
        </div>
        <div>
          <dt>{copy.returnSupplierReduction}</dt>
          <dd>
            <bdi>{purchaseReturn.supplierReductionFils}</bdi> {copy.fils}
          </dd>
        </div>
        <div>
          <dt>{copy.originalInvoice}</dt>
          <dd>
            <bdi>{formatNumber({ number: purchaseReturn.originalNumber })}</bdi>{" "}
            · <bdi>{purchaseReturn.originalInvoiceDate}</bdi>
          </dd>
        </div>
      </dl>
      <div className="posted-return-proof">
        <p>{purchaseReturn.supplierNameSnapshot}</p>
        <ul>
          {purchaseReturn.rows.map((row) => (
            <li key={row.id}>
              {row.itemDisplayName}: {row.quantity} · {row.carryingAmountFils} /{" "}
              {row.supplierReductionFils}
            </li>
          ))}
        </ul>
      </div>
      <div className="posted-correction-actions">
        <button type="button" className="quiet-button" onClick={onBack}>
          {copy.backToInvoice}
        </button>
      </div>
    </article>
  );
}

export function PostedPurchaseSnapshot({
  detail,
  print = false,
}: {
  readonly detail: PurchasePostedDetail;
  readonly print?: boolean;
}): React.JSX.Element | null {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const costsVisible = detail.costVisibility === "visible";
  if (typeof document === "undefined") return null;
  return (
    <article
      aria-hidden={print || undefined}
      className={print ? "purchase-snapshot-print" : "posted-purchase-snapshot"}
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
    >
      <header className="purchase-snapshot-print-header">
        <div>
          <p className="purchase-snapshot-print-kicker">
            {copy.historicalSnapshot}
          </p>
          <h1>{copy.postedPurchase}</h1>
        </div>
        <p className="purchase-snapshot-print-number">
          <bdi dir="ltr">{formatNumber(detail)}</bdi>
        </p>
      </header>
      <p className="purchase-snapshot-print-note">{copy.snapshotBoundary}</p>
      <dl className="purchase-snapshot-print-meta">
        <div>
          <dt>{copy.supplier}</dt>
          <dd>{detail.supplierNameSnapshot}</dd>
        </div>
        <div>
          <dt>{copy.supplierInvoice}</dt>
          <dd>
            <bdi>{detail.supplierInvoiceNumber}</bdi>
          </dd>
        </div>
        <div>
          <dt>{copy.invoiceDate}</dt>
          <dd>
            <bdi dir="ltr">{detail.invoiceDate}</bdi>
          </dd>
        </div>
        <div>
          <dt>{copy.postedAt}</dt>
          <dd>
            <bdi>{formatTimestamp(detail.postedAt, locale)}</bdi>
          </dd>
        </div>
        {costsVisible ? (
          <div>
            <dt>{copy.snapshot}</dt>
            <dd>
              <bdi>{detail.allowancePercentageSnapshot}%</bdi>
            </dd>
          </div>
        ) : null}
      </dl>
      {costsVisible ? null : (
        <p>
          {detail.costVisibility === "hidden-by-permission"
            ? copy.costsHiddenByPermission
            : copy.costsHiddenBySetting}
        </p>
      )}
      <h2 className="purchase-snapshot-print-table-title">{copy.postedRows}</h2>
      <table>
        <colgroup>
          <col style={{ width: "5%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "11%" }} />
          {costsVisible ? <col style={{ width: "13%" }} /> : null}
          {costsVisible ? <col style={{ width: "13%" }} /> : null}
          <col style={{ width: "11%" }} />
          <col style={{ width: costsVisible ? "9%" : "35%" }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">{copy.item}</th>
            <th scope="col">{copy.quantity}</th>
            <th scope="col">{copy.unit}</th>
            <th scope="col">{copy.retail}</th>
            {costsVisible ? (
              <th scope="col">{copy.primarySupplierCost}</th>
            ) : null}
            {costsVisible ? (
              <th scope="col">{copy.costAfterDiscount}</th>
            ) : null}
            <th scope="col">{copy.expiry}</th>
            <th scope="col">{copy.lot}</th>
          </tr>
        </thead>
        <tbody>
          {detail.rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.ordinal}</th>
              <td>{row.itemDisplayName}</td>
              <td>
                <bdi>{row.inventoryUnitQuantity}</bdi>
              </td>
              <td>
                {panelUnitLabel(
                  row.inventoryUnitName,
                  unitQuantity(row.inventoryUnitQuantity),
                  locale,
                )}
              </td>
              <td>
                <bdi>{formatFilsToIqd(row.retailPriceFils, locale)}</bdi>
              </td>
              {costsVisible ? (
                <td>
                  <bdi>
                    {formatFilsToIqd(row.linePrimarySupplierCostFils, locale)}
                  </bdi>
                </td>
              ) : null}
              {costsVisible ? (
                <td>
                  <bdi>
                    {formatFilsToIqd(row.costAfterDiscountFils, locale)}
                  </bdi>
                </td>
              ) : null}
              <td>
                <bdi dir="ltr">{row.expiryDate ?? "—"}</bdi>
              </td>
              <td>{row.lotNumber ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {costsVisible ? (
        <section className="purchase-snapshot-print-summary">
          <h2>{copy.invoiceTotals}</h2>
          <dl>
            <div>
              <dt>{copy.primarySupplierCost}</dt>
              <dd>
                <bdi>
                  {formatFilsToIqd(detail.primarySupplierCostFils, locale)}
                </bdi>
              </dd>
            </div>
            <div>
              <dt>{copy.allowanceAmount}</dt>
              <dd>
                <bdi>{formatFilsToIqd(detail.allowanceFils, locale)}</bdi>
              </dd>
            </div>
            <div className="purchase-snapshot-print-total">
              <dt>{copy.costAfterDiscount}</dt>
              <dd>
                <bdi>
                  {formatFilsToIqd(detail.costAfterDiscountFils, locale)}
                </bdi>
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
      {detail.adjustments.length === 0 ? null : (
        <section className="purchase-snapshot-print-links">
          <h2>{copy.adjustmentStageTitle}</h2>
          <ul>
            {detail.adjustments.map((adjustment) => (
              <li key={adjustment.id}>
                {formatAdjustmentNumber(adjustment.number)} ·{" "}
                {adjustment.reason} · {adjustment.quantityDelta}
              </li>
            ))}
          </ul>
        </section>
      )}
      {detail.returns.length === 0 ? null : (
        <section className="purchase-snapshot-print-links">
          <h2>{copy.returnStageTitle}</h2>
          <ul>
            {detail.returns.map((purchaseReturn) => (
              <li key={purchaseReturn.id}>
                {formatReturnNumber(purchaseReturn.number)} ·{" "}
                {purchaseReturn.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

export function formatNumber(value: {
  readonly number: {
    readonly series: "P";
    readonly value: string;
    readonly year: number;
  };
}): string {
  return `${value.number.series}${value.number.value}/${value.number.year}`;
}

export function formatAdjustmentNumber(number: {
  readonly original: {
    readonly series: "P";
    readonly value: string;
    readonly year: number;
  };
  readonly suffix: string;
}): string {
  return `${number.original.series}${number.original.value}-A${number.suffix.padStart(2, "0")}/${number.original.year}`;
}

export function formatReturnNumber(number: {
  readonly series: "PR";
  readonly value: string;
  readonly year: number;
}): string {
  return `${number.series}${number.value}/${number.year}`;
}

export function formatTimestamp(value: string, locale: "ar" | "en"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
