import type { PoolClient } from "pg";

export interface PostedPurchaseReference {
  readonly number: {
    readonly series: "P";
    readonly value: string;
    readonly year: number;
  };
  readonly supplierId: string;
  readonly supplierName: string;
}

export async function resolvePostedPurchaseReferences(
  client: PoolClient,
  pharmacyId: string,
  ids: readonly string[],
): Promise<Map<string, PostedPurchaseReference>> {
  if (ids.length === 0) return new Map();
  const result = await client.query<{
    id: string;
    number_value: string;
    number_year: number;
    supplier_id: string;
    supplier_name_snapshot: string;
  }>(
    `select id, number_value::text, number_year, supplier_id,
            supplier_name_snapshot
     from posted_purchases
     where pharmacy_id = $1 and id = any($2::uuid[])`,
    [pharmacyId, ids],
  );
  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        number: { series: "P", value: row.number_value, year: row.number_year },
        supplierId: row.supplier_id,
        supplierName: row.supplier_name_snapshot,
      },
    ]),
  );
}

export interface SupplierCostFact {
  readonly lastCostAfterDiscountFils: string | null;
  readonly lastInvoiceDate: string | null;
  readonly lastPostedPurchaseId: string | null;
  readonly lastPrimarySupplierCostFils: string | null;
  readonly productId: string;
  readonly receiptCount: string;
  readonly supplierId: string;
  readonly supplierName: string;
}

export async function resolveSupplierCostFacts(
  client: PoolClient,
  pharmacyId: string,
): Promise<Map<string, SupplierCostFact[]>> {
  const result = await client.query<{
    cost_after_discount_fils: string;
    invoice_date: string;
    last_posted_purchase_id: string;
    last_primary_supplier_cost_fils: string;
    product_id: string;
    receipt_count: string;
    supplier_id: string;
    supplier_name: string;
  }>(
    `with supplier_rows as (
       select row.product_id,
              purchase.supplier_id,
              purchase.supplier_name_snapshot as supplier_name,
              row.cost_after_discount_fils::text as cost_after_discount_fils,
              purchase.invoice_date::text as invoice_date,
              purchase.id as last_posted_purchase_id,
              row.primary_supplier_cost_fils::text as last_primary_supplier_cost_fils,
              count(*) over (
                partition by row.product_id, purchase.supplier_id
              )::text as receipt_count,
              row_number() over (
                partition by row.product_id, purchase.supplier_id
                order by purchase.invoice_date desc, purchase.posted_at desc,
                         purchase.id desc, row.ordinal desc
              ) as row_number
       from posted_purchase_rows row
       join posted_purchases purchase
         on purchase.id = row.posted_purchase_id
        and purchase.pharmacy_id = row.pharmacy_id
       where row.pharmacy_id = $1
     )
     select product_id, supplier_id, supplier_name, cost_after_discount_fils,
            invoice_date, last_posted_purchase_id,
            last_primary_supplier_cost_fils, receipt_count
     from supplier_rows
     where row_number = 1
     order by product_id, supplier_id`,
    [pharmacyId],
  );
  const facts = new Map<string, SupplierCostFact[]>();
  for (const row of result.rows) {
    const list = facts.get(row.product_id) ?? [];
    list.push({
      lastCostAfterDiscountFils: row.cost_after_discount_fils,
      lastInvoiceDate: row.invoice_date,
      lastPostedPurchaseId: row.last_posted_purchase_id,
      lastPrimarySupplierCostFils: row.last_primary_supplier_cost_fils,
      productId: row.product_id,
      receiptCount: row.receipt_count,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
    });
    facts.set(row.product_id, list);
  }
  return facts;
}
