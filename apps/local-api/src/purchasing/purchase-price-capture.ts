import type { PurchasePriceCapture } from "@breev/contracts/local-rest";

import {
  resolveCatalogPricing,
  type CatalogPricing,
} from "../catalog/catalog-pricing.js";

/**
 * What a posted purchase row records as its retail price, and whether that
 * price also becomes the item's current price.
 *
 * docs/domain.md §"Sales, prices, settlement, and corrections", first bullet:
 * "in **By Price** mode the percentage field is unavailable and the retail
 * price is editable on the purchase invoice -- once saved, the latest approved
 * retail price becomes the item's current price until the record or a later
 * invoice changes it; in **By Percentage** mode the retail price is locked and
 * the percentage is editable -- the system calculates the price from the
 * approved cost and stored percentage."
 *
 * Two things follow, and both are decided here rather than at the database:
 *
 * - By Price propagates. The invoice's approved price is the snapshot *and*
 *   the item's new current price, so posting has to ask Catalog to write it.
 * - By Percentage calculates and does not propagate. The invoice never sets a
 *   price by hand, so there is nothing approved to push back into the item
 *   record; the row stores the price the current cost and percentage produce.
 *
 * The percentage arithmetic itself is not restated here. It is
 * `resolveCatalogPricing`, the same policy the item screen and the row commit
 * already use -- margin on the selling price, one rounding onto the configured
 * step -- so a purchase invoice and an item edit can never calculate two
 * different prices from the same cost and percentage.
 *
 * Framework-free: no Nest, Drizzle, PostgreSQL, or transport code.
 */

/** The committed row's own pricing facts, as stored on the Purchase Draft. */
export interface PurchaseRowPricingFacts {
  /** The row's Primary Supplier Cost per entered unit, as exact text. */
  readonly costFils: string;
  /** Set in By Percentage mode only. */
  readonly marginPercentage: string | null;
  readonly method: "by-percentage" | "by-price";
  /** The approved retail price the row captured in By Price mode. */
  readonly retailPriceFils: string;
}

export interface PurchasePriceCaptureResult {
  readonly capture: PurchasePriceCapture;
  /**
   * The new current price Catalog must store on the item, or `null` when the
   * item record is not rewritten -- because the method calculates rather than
   * propagates, or because the item already carries this exact price.
   */
  readonly itemPriceUpdateFils: string | null;
  /** Recorded on the snapshot in By Percentage mode; `null` in By Price. */
  readonly marginPercentage: string | null;
  /** The retail price the posted row snapshot records. */
  readonly retailPriceFils: string;
}

export type PurchasePriceCaptureProblem =
  "margin-missing" | "pricing-mode-changed" | "retail-price-invalid";

export type PurchasePriceCaptureOutcome =
  | { readonly ok: true; readonly result: PurchasePriceCaptureResult }
  | { readonly ok: false; readonly problem: PurchasePriceCaptureProblem };

/**
 * Decides one row's captured price from the item's **current** pricing method,
 * not from the method the row was entered under.
 *
 * Posting "recalculates it from current authoritative state" (docs/domain.md
 * §"Shared transaction model"), and an item whose method changed between row
 * entry and posting is exactly the case that rule exists for: the row's
 * captured price is no longer meaningful under the new method, so the post is
 * refused with a named rule rather than silently repriced.
 */
export function capturePurchaseRetailPrice(
  productPricing: CatalogPricing,
  row: PurchaseRowPricingFacts,
): PurchasePriceCaptureOutcome {
  if (productPricing.method !== row.method) {
    return { ok: false, problem: "pricing-mode-changed" };
  }

  if (productPricing.method === "by-price") {
    const approved = resolveCatalogPricing({
      method: "by-price",
      retailPriceFils: row.retailPriceFils,
      wholesalePriceFils: productPricing.wholesalePriceFils,
    });
    if (!approved.ok) return { ok: false, problem: "retail-price-invalid" };
    return {
      ok: true,
      result: {
        capture: "by-price-propagated",
        itemPriceUpdateFils:
          row.retailPriceFils === productPricing.retailPriceFils
            ? null
            : row.retailPriceFils,
        marginPercentage: null,
        retailPriceFils: row.retailPriceFils,
      },
    };
  }

  if (row.marginPercentage === null) {
    return { ok: false, problem: "margin-missing" };
  }
  const calculated = resolveCatalogPricing({
    costFils: row.costFils,
    marginPercentage: row.marginPercentage,
    method: "by-percentage",
    rounding: productPricing.rounding,
    wholesalePriceFils: productPricing.wholesalePriceFils,
  });
  if (!calculated.ok || calculated.pricing.method !== "by-percentage") {
    return { ok: false, problem: "retail-price-invalid" };
  }
  return {
    ok: true,
    result: {
      capture: "by-percentage-calculated",
      itemPriceUpdateFils: null,
      marginPercentage: row.marginPercentage,
      retailPriceFils: calculated.pricing.retailPriceFils,
    },
  };
}
