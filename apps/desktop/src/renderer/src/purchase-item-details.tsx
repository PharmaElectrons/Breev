import type {
  Product,
  PurchaseEntryPreferences,
} from "@breev/contracts/local-rest";
import { purchasingMessages } from "./purchasing-messages";
import { usePreferences } from "./preferences-provider";

/**
 * The item the purchase row currently names, together with the details the
 * pharmacy's saved entry preferences allow the panel to show.
 */
export interface PurchaseItemSelection {
  readonly fields: PurchaseEntryPreferences["detailsPanelFields"];
  readonly product: Product;
}

/**
 * The purchasing item-details panel.
 *
 * One element serves the whole purchasing screen, because the panel is the
 * only surface that carries the wholesale price and the user reads it while a
 * row is being typed. That rules out two placements the screen used to have at
 * once: inside `.purchase-row-layout`, where the panel sat beyond the right
 * edge of the horizontally scrolling row table, and a second, permanently
 * empty aside that promised details it could never show.
 *
 * So the panel lives in the slot the shell already reserves for it. Above
 * 80rem that is the fixed 20rem column the workspace keeps clear with
 * `margin-inline-end`. Below 80rem — which includes the default 1080x720
 * window and every verification viewport — a side column does not fit, so it
 * becomes a bounded band directly under the invoice header, above the row
 * table rather than below the page fold.
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
  return (
    <aside
      className="purchase-item-sidebar purchase-item-panel"
      aria-labelledby="purchase-item-panel-title"
      hidden={hidden}
      // The panel scrolls inside itself, and a browser that makes scroll
      // containers keyboard-focusable would otherwise insert it into the row
      // entry's Enter-to-advance loop as a tab stop. `-1` keeps it reachable
      // programmatically and to assistive technology without taking a turn in
      // the sequential order.
      tabIndex={-1}
    >
      <h2 id="purchase-item-panel-title">{copy.itemDetails}</h2>
      {selection === null ? (
        <div className="purchase-item-empty">
          <span className="purchase-item-symbol" aria-hidden="true">
            <span />
          </span>
          <p>{copy.noSelectedItem}</p>
        </div>
      ) : (
        <div className="purchase-item-facts">
          <strong>{selection.product.displayName}</strong>
          <dl>
            {selection.fields.includes("scientific-name") ? (
              <div>
                <dt>{copy.scientificName}</dt>
                <dd>{selection.product.scientificName ?? "—"}</dd>
              </div>
            ) : null}
            {selection.fields.includes("category") ? (
              <div>
                <dt>{copy.category}</dt>
                <dd>{selection.product.category ?? "—"}</dd>
              </div>
            ) : null}
            {selection.fields.includes("packaging") ? (
              <div>
                <dt>{copy.packaging}</dt>
                <dd>{packagingText(selection.product)}</dd>
              </div>
            ) : null}
            {selection.fields.includes("wholesale-price") ? (
              <div>
                <dt>{copy.wholesalePrice}</dt>
                <dd>
                  <bdi>
                    {selection.product.pricing.wholesalePriceFils ?? "—"}
                  </bdi>
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      )}
    </aside>
  );
}

function packagingText(product: Product): string {
  const packages = product.packaging.packageUnits.map(
    (unit) => `${unit.name} × ${unit.baseUnitsPerPackage}`,
  );
  return [product.packaging.inventoryUnitName, ...packages].join(" · ");
}
