import type { PoolClient } from "pg";
import type { ProductPricingMethod } from "@breev/contracts/local-rest";
import {
  resolveCatalogInventoryFacts,
  resolveCatalogPackagingFacts,
} from "./catalog-inventory.js";

/** Catalog's current panel facts. No mutable Catalog fact becomes a posted snapshot. */
export async function resolveCatalogPurchasePanel(
  client: PoolClient,
  pharmacyId: string,
  productId: string,
) {
  const result = await client.query<{
    id: string;
    display_name: string;
    scientific_name: string | null;
    category: string | null;
    pricing_method: ProductPricingMethod;
    retail_price_fils: string;
    wholesale_price_fils: string | null;
    barcode: string | null;
  }>(
    `select product.id, product.display_name, product.scientific_name, product.category,
              product.pricing_method, product.retail_price_fils::text, product.wholesale_price_fils::text,
              (select barcode.barcode from catalog_product_barcodes barcode
               where barcode.pharmacy_id = product.pharmacy_id and barcode.product_id = product.id
                 and barcode.removed_at is null order by barcode.ordinal, barcode.barcode limit 1) as barcode
       from catalog_products product where product.pharmacy_id = $1 and product.id = $2 and product.status = 'active'`,
    [pharmacyId, productId],
  );
  const product = result.rows[0];
  if (product === undefined) return null;
  const facts = (
    await resolveCatalogInventoryFacts(client, pharmacyId, {
      productIds: [productId],
    })
  ).get(productId);
  const packaging = (
    await resolveCatalogPackagingFacts(client, pharmacyId, [productId])
  ).get(productId);
  if (facts === undefined || packaging === undefined)
    throw new Error("Catalog panel facts are incomplete");
  return { product, facts, packaging };
}
