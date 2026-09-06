import type { PoolClient } from "pg";
import type {
  PackagingDefinition,
  UnitReference,
} from "./catalog-packaging.js";
import type { PriceRoundingSetting } from "./catalog-pricing.js";

export interface CatalogPurchaseProduct {
  readonly displayName: string;
  readonly id: string;
  readonly packaging: PackagingDefinition;
  readonly pricing:
    | {
        readonly method: "by-price";
        readonly retailPriceFils: string;
        readonly wholesalePriceFils: string | null;
      }
    | {
        readonly marginPercentage: string;
        readonly method: "by-percentage";
        readonly retailPriceFils: string;
        readonly rounding: PriceRoundingSetting;
        readonly wholesalePriceFils: string | null;
      };
}

interface ProductRow {
  count_default_unit_id: string;
  display_name: string;
  id: string;
  margin_percentage: string | null;
  price_rounding: PriceRoundingSetting | null;
  purchase_default_unit_id: string;
  retail_price_fils: string;
  sale_default_unit_id: string;
  status: "active" | "archived" | "merged";
  pricing_method: "by-percentage" | "by-price";
  wholesale_price_fils: string | null;
}

interface UnitRow {
  base_units_per_package: string | null;
  id: string;
  kind: "inventory" | "package";
  name: string;
}

/** Catalog's narrow transaction-aware read used by Purchasing row commits. */
export async function resolveCatalogPurchaseProduct(
  client: PoolClient,
  pharmacyId: string,
  productId: string,
): Promise<CatalogPurchaseProduct | null | undefined> {
  const result = await client.query<ProductRow>(
    `with recursive product_chain as (
       select product_row.* from catalog_products product_row
       where product_row.pharmacy_id = $1 and product_row.id = $2
       union all
       select survivor.* from catalog_products survivor
       join product_chain prior on survivor.id = prior.merged_into_product_id
       where survivor.pharmacy_id = $1
     )
     select id, display_name, count_default_unit_id, purchase_default_unit_id,
            sale_default_unit_id, pricing_method, retail_price_fils::text,
            wholesale_price_fils::text, margin_percentage::text, price_rounding,
            status
     from product_chain
     where merged_into_product_id is null
     limit 1`,
    [pharmacyId, productId],
  );
  const resolved = result.rows[0];
  if (resolved === undefined) return undefined;
  if (resolved.status !== "active") return null;
  const locked = await client.query<ProductRow>(
    `select id, display_name, count_default_unit_id, purchase_default_unit_id,
            sale_default_unit_id, pricing_method, retail_price_fils::text,
            wholesale_price_fils::text, margin_percentage::text, price_rounding,
            status
     from catalog_products
     where pharmacy_id = $1 and id = $2
     for share`,
    [pharmacyId, resolved.id],
  );
  const product = locked.rows[0];
  if (product === undefined) return undefined;
  if (product.status !== "active") return null;
  const [unitResult, thirdResult] = await Promise.all([
    client.query<UnitRow>(
      `select id, name, kind, base_units_per_package::text
       from catalog_product_units
       where pharmacy_id = $1 and product_id = $2
       order by ordinal`,
      [pharmacyId, product.id],
    ),
    client.query<{ name: string }>(
      `select name from catalog_product_third_units
       where pharmacy_id = $1 and product_id = $2`,
      [pharmacyId, product.id],
    ),
  ]);
  const inventoryUnit = unitResult.rows.find(
    ({ kind }) => kind === "inventory",
  );
  if (inventoryUnit === undefined) {
    throw new Error("The Catalog Product has no Inventory Unit");
  }
  const defaultUnit = (unitId: string): UnitReference => {
    const unit = unitResult.rows.find(({ id }) => id === unitId);
    if (unit === undefined)
      throw new Error("The Catalog default unit is missing");
    return unit.kind === "inventory"
      ? { kind: "inventory-unit" }
      : { kind: "package-unit", packageUnitName: unit.name };
  };
  const packaging: PackagingDefinition = {
    defaultUnits: {
      count: defaultUnit(product.count_default_unit_id),
      purchase: defaultUnit(product.purchase_default_unit_id),
      sale: defaultUnit(product.sale_default_unit_id),
    },
    inventoryUnitName: inventoryUnit.name,
    packageUnits: unitResult.rows
      .filter(
        (unit): unit is UnitRow & { base_units_per_package: string } =>
          unit.kind === "package" && unit.base_units_per_package !== null,
      )
      .map((unit) => ({
        baseUnitsPerPackage: unit.base_units_per_package,
        name: unit.name,
      })),
    thirdUnit:
      thirdResult.rows[0] === undefined
        ? null
        : { name: thirdResult.rows[0].name },
  };

  if (product.pricing_method === "by-price") {
    return {
      displayName: product.display_name,
      id: product.id,
      packaging,
      pricing: {
        method: "by-price",
        retailPriceFils: product.retail_price_fils,
        wholesalePriceFils: product.wholesale_price_fils,
      },
    };
  }
  if (product.margin_percentage === null || product.price_rounding === null) {
    throw new Error("The By Percentage Catalog Product is incomplete");
  }
  return {
    displayName: product.display_name,
    id: product.id,
    packaging,
    pricing: {
      marginPercentage: normalizeDecimal(product.margin_percentage),
      method: "by-percentage",
      retailPriceFils: product.retail_price_fils,
      rounding: product.price_rounding,
      wholesalePriceFils: product.wholesale_price_fils,
    },
  };
}

function normalizeDecimal(value: string): string {
  return value.includes(".")
    ? value.replace(/0+$/u, "").replace(/\.$/u, "")
    : value;
}
