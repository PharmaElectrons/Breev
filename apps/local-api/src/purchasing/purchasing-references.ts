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

export interface PostedPurchaseAdjustmentReference {
  readonly number: PostedPurchaseReference["number"];
  readonly originalPurchaseId: string;
  readonly suffixValue: string;
  readonly supplierNameSnapshot: string;
}

export interface PostedPurchaseReturnReference {
  readonly originalNumber: PostedPurchaseReference["number"];
  readonly originalPurchaseId: string;
  readonly returnNumber: {
    readonly series: "PR";
    readonly value: string;
    readonly year: number;
  };
  readonly supplierNameSnapshot: string;
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

export async function resolvePostedPurchaseAdjustmentReferences(
  client: PoolClient,
  pharmacyId: string,
  ids: readonly string[],
): Promise<Map<string, PostedPurchaseAdjustmentReference>> {
  if (ids.length === 0) return new Map();
  const result = await client.query<{
    id: string;
    number_value: string;
    number_year: number;
    original_purchase_id: string;
    suffix_value: string;
    supplier_name_snapshot: string;
  }>(
    `select adjustment.id, adjustment.original_purchase_id,
            original.number_value::text, original.number_year,
            adjustment.suffix_value::text, adjustment.supplier_name_snapshot
     from posted_purchase_adjustments adjustment
     join posted_purchases original
       on original.id = adjustment.original_purchase_id
      and original.pharmacy_id = adjustment.pharmacy_id
     where adjustment.pharmacy_id = $1 and adjustment.id = any($2::uuid[])`,
    [pharmacyId, ids],
  );
  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        number: { series: "P", value: row.number_value, year: row.number_year },
        originalPurchaseId: row.original_purchase_id,
        suffixValue: row.suffix_value,
        supplierNameSnapshot: row.supplier_name_snapshot,
      },
    ]),
  );
}

export async function resolvePostedPurchaseReturnReferences(
  client: PoolClient,
  pharmacyId: string,
  ids: readonly string[],
): Promise<Map<string, PostedPurchaseReturnReference>> {
  if (ids.length === 0) return new Map();
  const result = await client.query<{
    id: string;
    original_number_value: string;
    original_number_year: number;
    original_purchase_id: string;
    return_number_value: string;
    return_number_year: number;
    supplier_name_snapshot: string;
  }>(
    `select return_record.id,
            return_record.original_purchase_id,
            return_record.original_number_value::text as original_number_value,
            return_record.original_number_year,
            return_record.number_value::text as return_number_value,
            return_record.number_year as return_number_year,
            return_record.supplier_name_snapshot
     from posted_purchase_returns return_record
     where return_record.pharmacy_id = $1
       and return_record.id = any($2::uuid[])`,
    [pharmacyId, ids],
  );
  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        originalNumber: {
          series: "P",
          value: row.original_number_value,
          year: row.original_number_year,
        },
        originalPurchaseId: row.original_purchase_id,
        returnNumber: {
          series: "PR",
          value: row.return_number_value,
          year: row.return_number_year,
        },
        supplierNameSnapshot: row.supplier_name_snapshot,
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
