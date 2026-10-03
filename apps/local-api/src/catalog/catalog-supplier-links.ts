import type { PoolClient } from "pg";

export function normalizeSupplierIds(supplierIds: readonly string[]): string[] {
  return [...new Set(supplierIds)].sort();
}

export async function replaceProductSupplierLinks(
  client: PoolClient,
  input: {
    readonly actorId: string;
    readonly pharmacyId: string;
    readonly productId: string;
    readonly supplierIds: readonly string[];
  },
): Promise<void> {
  const supplierIds = normalizeSupplierIds(input.supplierIds);
  await client.query(
    `delete from catalog_product_suppliers
     where pharmacy_id = $1 and product_id = $2
       and not (supplier_id = any($3::uuid[]))`,
    [input.pharmacyId, input.productId, supplierIds],
  );
  if (supplierIds.length === 0) return;

  await client.query(
    `insert into catalog_product_suppliers (
       pharmacy_id, product_id, supplier_id, recorded_by
     )
     select $1, $2, selected.supplier_id, $4
     from unnest($3::uuid[]) as selected(supplier_id)
     on conflict (product_id, supplier_id) do nothing`,
    [input.pharmacyId, input.productId, supplierIds, input.actorId],
  );
}

/**
 * A Product merge keeps the merged record's original links for history and
 * unions them onto the active survivor. Duplicate supplier links collapse at
 * the relation's primary key.
 */
export async function unionProductSupplierLinks(
  client: PoolClient,
  input: {
    readonly actorId: string;
    readonly pharmacyId: string;
    readonly sourceProductId: string;
    readonly survivorProductId: string;
  },
): Promise<boolean> {
  const inserted = await client.query(
    `insert into catalog_product_suppliers (
       pharmacy_id, product_id, supplier_id, recorded_by
     )
     select source_link.pharmacy_id, $3, source_link.supplier_id, $4
     from catalog_product_suppliers source_link
     where source_link.pharmacy_id = $1
       and source_link.product_id = $2
     on conflict (product_id, supplier_id) do nothing`,
    [
      input.pharmacyId,
      input.sourceProductId,
      input.survivorProductId,
      input.actorId,
    ],
  );
  return (inserted.rowCount ?? 0) > 0;
}

/**
 * A supplier merge redirects links on active Products to its active survivor.
 * Archived and already-merged Product records retain their old link for
 * historical display. Revisions advance with each active Product's new set.
 */
export async function transferActiveProductSupplierLinks(
  client: PoolClient,
  input: {
    readonly actorId: string;
    readonly pharmacyId: string;
    readonly sourceSupplierId: string;
    readonly survivorSupplierId: string;
  },
): Promise<string[]> {
  const affected = await client.query<{ readonly id: string }>(
    `select product_row.id
     from catalog_products product_row
     where product_row.pharmacy_id = $1
       and product_row.status = 'active'
       and exists (
         select 1
         from catalog_product_suppliers link_row
         where link_row.pharmacy_id = product_row.pharmacy_id
           and link_row.product_id = product_row.id
           and link_row.supplier_id = $2
       )
     order by product_row.id
     for update of product_row`,
    [input.pharmacyId, input.sourceSupplierId],
  );
  const productIds = affected.rows.map(({ id }) => id);
  if (productIds.length === 0) return [];

  await client.query(
    `delete from catalog_product_suppliers source_link
     where source_link.pharmacy_id = $1
       and source_link.supplier_id = $2
       and source_link.product_id = any($4::uuid[])
       and exists (
         select 1
         from catalog_product_suppliers survivor_link
         where survivor_link.pharmacy_id = source_link.pharmacy_id
           and survivor_link.product_id = source_link.product_id
           and survivor_link.supplier_id = $3
       )`,
    [
      input.pharmacyId,
      input.sourceSupplierId,
      input.survivorSupplierId,
      productIds,
    ],
  );
  await client.query(
    `update catalog_product_suppliers
     set supplier_id = $3
     where pharmacy_id = $1
       and supplier_id = $2
       and product_id = any($4::uuid[])`,
    [
      input.pharmacyId,
      input.sourceSupplierId,
      input.survivorSupplierId,
      productIds,
    ],
  );
  const revised = await client.query<{ readonly id: string }>(
    `update catalog_products product_row
     set revision = product_row.revision + 1,
         updated_at = statement_timestamp(),
         updated_by = $3
     where product_row.pharmacy_id = $1
       and product_row.id = any($2::uuid[])
       and product_row.status = 'active'
     returning product_row.id`,
    [input.pharmacyId, productIds, input.actorId],
  );
  return revised.rows.map(({ id }) => id).sort();
}
