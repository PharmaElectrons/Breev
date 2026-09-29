import type { CatalogSupplierOption } from "@breev/contracts/local-rest";
import type { PoolClient } from "pg";

/**
 * Purchasing owns supplier records; Catalog receives only the small identity
 * and status projection needed to label and validate product links.
 */
export async function listCatalogSupplierOptions(
  client: PoolClient,
  pharmacyId: string,
): Promise<CatalogSupplierOption[]> {
  const result = await client.query<CatalogSupplierOption>(
    `select id, name, status
     from suppliers
     where pharmacy_id = $1
     order by lower(name), id`,
    [pharmacyId],
  );
  return result.rows;
}

/**
 * New links may target active suppliers. An inactive supplier remains valid
 * only while that exact link already exists, so editing unrelated Product
 * fields does not silently remove an archived historical association.
 */
export async function catalogSupplierSelectionsAreValid(
  client: PoolClient,
  pharmacyId: string,
  supplierIds: readonly string[],
  retainedSupplierIds: readonly string[],
): Promise<boolean> {
  if (supplierIds.length === 0) return true;

  const rows = await client.query<{
    readonly id: string;
    readonly status: CatalogSupplierOption["status"];
  }>(
    `select supplier_row.id, supplier_row.status
     from suppliers supplier_row
     where supplier_row.pharmacy_id = $1
       and supplier_row.id = any($2::uuid[])
     order by supplier_row.id
     for share of supplier_row`,
    [pharmacyId, [...supplierIds]],
  );
  if (rows.rows.length !== supplierIds.length) return false;

  const retained = new Set(retainedSupplierIds);
  return rows.rows.every(
    (supplier) => supplier.status === "active" || retained.has(supplier.id),
  );
}
