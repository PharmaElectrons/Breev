import type { PoolClient } from "pg";

/**
 * Catalog's narrow transaction-aware write used by purchase posting: pushing
 * a By Price invoice's approved retail price back onto the item record
 * (docs/domain.md §"Sales, prices, settlement, and corrections", first
 * bullet). This writes only `catalog_products`, the table Catalog owns, and
 * never a Purchasing or Inventory table.
 *
 * The caller has already re-read the product inside the same transaction
 * (`resolveCatalogPurchaseProduct`) and decided, through
 * `capturePurchaseRetailPrice`, that this exact price differs from the
 * item's current one. A row count other than one here means the product
 * changed state between that read and this write inside the same
 * transaction, which cannot happen without a bug in the caller, so this
 * throws rather than returning a value a caller could silently ignore.
 */
export async function applyPurchasePriceUpdate(
  client: PoolClient,
  pharmacyId: string,
  productId: string,
  retailPriceFils: string,
  actorId: string,
): Promise<void> {
  const updated = await client.query(
    `update catalog_products
     set retail_price_fils = $3::bigint, revision = revision + 1,
         updated_at = statement_timestamp(), updated_by = $4
     where pharmacy_id = $1 and id = $2 and status = 'active'`,
    [pharmacyId, productId, retailPriceFils, actorId],
  );
  if (updated.rowCount !== 1) {
    throw new Error(
      "The Catalog Product price was not updated by the purchase posting",
    );
  }
}
