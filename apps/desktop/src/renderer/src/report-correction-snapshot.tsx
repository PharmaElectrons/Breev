import type {
  PostedPurchaseAdjustment,
  PostedPurchaseReturn,
} from "@breev/contracts/local-rest";
import {
  formatAdjustmentNumber,
  formatNumber as purchaseNumber,
  formatReturnNumber,
  formatTimestamp,
} from "./posted-purchase-snapshots";
import { formatCurrencyFromFils, formatNumber } from "./preferences";
import { usePreferences } from "./preferences-provider";
import { reportMessages } from "./report-messages";
import {
  getAdjustmentReasonLabel,
  purchasingMessages,
} from "./purchasing-messages";

/** Read-only presentation of the values returned by the existing source APIs. */
export function ReportCorrectionSnapshot({
  document,
}: {
  readonly document: PostedPurchaseAdjustment | PostedPurchaseReturn;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const reportCopy = reportMessages[locale];
  const quantity = (value: string) => (
    <bdi>{formatNumber(BigInt(value), locale)}</bdi>
  );
  const money = (value: string) => (
    <bdi>{formatCurrencyFromFils(BigInt(value), locale)}</bdi>
  );
  if ("rowDeltas" in document) {
    return (
      <article className="report-correction-snapshot">
        <h3>
          <bdi dir="ltr">{formatAdjustmentNumber(document.number)}</bdi>
        </h3>
        <dl className="report-snapshot-meta">
          <div>
            <dt>{copy.adjustmentReason}</dt>
            <dd>{getAdjustmentReasonLabel(document.reason, locale)}</dd>
          </div>
          <div>
            <dt>{copy.postedAt}</dt>
            <dd>
              <bdi>{formatTimestamp(document.postedAt, locale)}</bdi>
            </dd>
          </div>
        </dl>
        <div
          className="report-snapshot-table-wrap"
          tabIndex={0}
          role="region"
          aria-label={copy.postedRows}
        >
          <table>
            <caption className="visually-hidden">{copy.postedRows}</caption>
            <thead>
              <tr>
                <th scope="col">{copy.item}</th>
                <th scope="col">{copy.qtyBefore}</th>
                <th scope="col">{copy.qtyAfter}</th>
                <th scope="col">{copy.quantity}</th>
              </tr>
            </thead>
            <tbody>
              {document.rowDeltas.map((row) => (
                <tr key={row.lineageId}>
                  <th scope="row">
                    <bdi>
                      {row.after?.itemDisplayName ??
                        row.before?.itemDisplayName}
                    </bdi>
                  </th>
                  <td>{quantity(row.before?.enteredQuantity ?? "0")}</td>
                  <td>{quantity(row.after?.enteredQuantity ?? "0")}</td>
                  <td>{quantity(row.quantityDelta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="report-snapshot-totals">
          <div>
            <dt>{copy.quantity}</dt>
            <dd>{quantity(document.quantityDelta)}</dd>
          </div>
          <div>
            <dt>{copy.primarySupplierCost}</dt>
            <dd>{money(document.primarySupplierCostDeltaFils)}</dd>
          </div>
        </dl>
      </article>
    );
  }
  return (
    <article className="report-correction-snapshot">
      <h3>
        <bdi dir="ltr">{formatReturnNumber(document.number)}</bdi>
      </h3>
      <dl className="report-snapshot-meta">
        <div>
          <dt>{copy.supplier}</dt>
          <dd>
            <bdi>{document.supplierNameSnapshot}</bdi>
          </dd>
        </div>
        <div>
          <dt>{copy.originalInvoice}</dt>
          <dd>
            <bdi dir="ltr">
              {purchaseNumber({ number: document.originalNumber })}
            </bdi>{" "}
            · <bdi dir="ltr">{document.originalInvoiceDate}</bdi>
          </dd>
        </div>
        <div>
          <dt>{copy.postedAt}</dt>
          <dd>
            <bdi>{formatTimestamp(document.postedAt, locale)}</bdi>
          </dd>
        </div>
        <div>
          <dt>{reportCopy.reason}</dt>
          <dd>
            <bdi>{document.reason}</bdi>
          </dd>
        </div>
      </dl>
      <p className="report-snapshot-evidence">
        <strong>{reportCopy.evidence}: </strong>
        <bdi>{document.evidence}</bdi>
      </p>
      <div
        className="report-snapshot-table-wrap"
        tabIndex={0}
        role="region"
        aria-label={copy.postedRows}
      >
        <table>
          <caption className="visually-hidden">{copy.postedRows}</caption>
          <thead>
            <tr>
              <th scope="col">{copy.item}</th>
              <th scope="col">{copy.quantity}</th>
              <th scope="col">{copy.returnCarryingAmount}</th>
              <th scope="col">{copy.returnSupplierReduction}</th>
            </tr>
          </thead>
          <tbody>
            {document.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <bdi>{row.itemDisplayName}</bdi>
                </th>
                <td>{quantity(row.quantity)}</td>
                <td>{money(row.carryingAmountFils)}</td>
                <td>{money(row.supplierReductionFils)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="report-snapshot-totals">
        <div>
          <dt>{copy.returnCarryingAmount}</dt>
          <dd>{money(document.inventoryCarryingAmountFils)}</dd>
        </div>
        <div>
          <dt>{copy.returnSupplierReduction}</dt>
          <dd>{money(document.supplierReductionFils)}</dd>
        </div>
      </dl>
    </article>
  );
}
