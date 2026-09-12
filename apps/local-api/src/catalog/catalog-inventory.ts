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
  readonly mergedIntoProductId?: string | null;
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
  readonly merged_into_product_id: string | null;
  readonly maximum_level: string | null;
  readonly minimum_level: string | null;
  readonly reorder_point: string | null;
  readonly status: ProductStatus;
}

/** Catalog's narrow read published for Inventory and Reporting composition. */
export async function resolveCatalogInventoryFacts(
  client: PoolClient,
  pharmacyId: string,
  options?: { readonly productIds?: readonly string[] },
): Promise<Map<string, CatalogInventoryFacts>> {
  const productIds = options?.productIds;
  if (productIds?.length === 0) return new Map();
  const filtered = productIds !== undefined;
  const result = await client.query<CatalogInventoryRow>(
    filtered
      ? `select product.id, product.display_name, product.status,
                product.manual_state_colour, product.cold_storage_required,
                product.minimum_level::text, product.maximum_level::text,
                product.reorder_point::text, product.merged_into_product_id,
                exists (
                  select 1 from catalog_product_barcodes barcode
                  where barcode.pharmacy_id = product.pharmacy_id
                    and barcode.product_id = product.id
                    and barcode.removed_at is null
                ) as has_barcode
         from catalog_products product
         where product.pharmacy_id = $1
           and product.id = any($2::uuid[])
         order by product.display_name, product.id`
      : `select product.id, product.display_name, product.status,
                product.manual_state_colour, product.cold_storage_required,
                product.minimum_level::text, product.maximum_level::text,
                product.reorder_point::text, product.merged_into_product_id,
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
    filtered ? [pharmacyId, productIds] : [pharmacyId],
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
        mergedIntoProductId: row.merged_into_product_id,
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

export interface CatalogPackagingFacts {
  readonly inventoryUnitName: string;
  readonly packageUnits: readonly {
    readonly baseUnitsPerPackage: string;
    readonly name: string;
  }[];
}

interface CatalogPackagingUnitRow {
  readonly base_units_per_package: string | null;
  readonly kind: "inventory" | "package";
  readonly name: string;
  readonly product_id: string;
}

/** Catalog's narrow packaging read used by Inventory's composed item views. */
export async function resolveCatalogPackagingFacts(
  client: PoolClient,
  pharmacyId: string,
  productIds: readonly string[],
): Promise<Map<string, CatalogPackagingFacts>> {
  if (productIds.length === 0) return new Map();
  const result = await client.query<CatalogPackagingUnitRow>(
    `select product_id, kind, name, base_units_per_package::text
     from catalog_product_units
     where pharmacy_id = $1 and product_id = any($2::uuid[])
     order by product_id, ordinal`,
    [pharmacyId, productIds],
  );
  const facts = new Map<string, CatalogPackagingFacts>();
  for (const row of result.rows) {
    const current = facts.get(row.product_id);
    if (row.kind === "inventory") {
      facts.set(row.product_id, {
        inventoryUnitName: row.name,
        packageUnits: current?.packageUnits ?? [],
      });
      continue;
    }
    if (row.base_units_per_package === null) continue;
    if (current === undefined) {
      throw new Error("The Catalog Product has no Inventory Unit");
    }
    facts.set(row.product_id, {
      inventoryUnitName: current.inventoryUnitName,
      packageUnits: [
        ...current.packageUnits,
        {
          baseUnitsPerPackage: row.base_units_per_package,
          name: row.name,
        },
      ],
    });
  }
  return facts;
}
