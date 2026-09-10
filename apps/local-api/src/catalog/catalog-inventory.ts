import type {
  ProductStatus,
  ProductStateColour,
} from "@breev/contracts/local-rest";
import type { PoolClient } from "pg";

export interface CatalogInventoryFacts {
  readonly coldStorageRequired: boolean;
  readonly displayName: string;
  readonly hasBarcode: boolean;
  readonly manualStateColour: ProductStateColour | null;
  readonly productId: string;
  readonly status: ProductStatus;
  readonly stockLevels: {
    readonly maximumLevel: bigint | null;
    readonly minimumLevel: bigint | null;
    readonly reorderPoint: bigint | null;
  };
}

interface CatalogInventoryRow {
  readonly cold_storage_required: boolean;
  readonly display_name: string;
  readonly has_barcode: boolean;
  readonly id: string;
  readonly manual_state_colour: ProductStateColour | null;
  readonly maximum_level: string | null;
  readonly minimum_level: string | null;
  readonly reorder_point: string | null;
  readonly status: ProductStatus;
}

/** Catalog's narrow read published for Inventory and Reporting composition. */
export async function resolveCatalogInventoryFacts(
  client: PoolClient,
  pharmacyId: string,
): Promise<Map<string, CatalogInventoryFacts>> {
  const result = await client.query<CatalogInventoryRow>(
    `select product.id, product.display_name, product.status,
            product.manual_state_colour, product.cold_storage_required,
            product.minimum_level::text, product.maximum_level::text,
            product.reorder_point::text,
            exists (
              select 1 from catalog_product_barcodes barcode
              where barcode.pharmacy_id = product.pharmacy_id
                and barcode.product_id = product.id
                and barcode.removed_at is null
            ) as has_barcode
     from catalog_products product
     where product.pharmacy_id = $1
       and product.status <> 'merged'
     order by product.display_name, product.id`,
    [pharmacyId],
  );
  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        coldStorageRequired: row.cold_storage_required,
        displayName: row.display_name,
        hasBarcode: row.has_barcode,
        manualStateColour: row.manual_state_colour,
        productId: row.id,
        status: row.status,
        stockLevels: {
          maximumLevel:
            row.maximum_level === null ? null : BigInt(row.maximum_level),
          minimumLevel:
            row.minimum_level === null ? null : BigInt(row.minimum_level),
          reorderPoint:
            row.reorder_point === null ? null : BigInt(row.reorder_point),
        },
      },
    ]),
  );
}
