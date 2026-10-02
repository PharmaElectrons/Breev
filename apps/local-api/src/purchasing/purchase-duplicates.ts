import type { PoolClient } from "pg";

/** Compare effective immutable headers using supplier identities, including merged aliases. */
export async function postedPurchaseWarnings(
  client: PoolClient,
  pharmacyId: string,
  supplierId: string,
  supplierInvoiceNumber: string,
  excludedOriginalPurchaseId: string | null = null,
): Promise<string[]> {
  const duplicate = await client.query<{ id: string }>(
    `with recursive ancestry(id, merged_into_supplier_id) as (
       select supplier_row.id, supplier_row.merged_into_supplier_id
       from suppliers supplier_row
       where supplier_row.pharmacy_id = $1 and supplier_row.id = $2
       union all
       select parent.id, parent.merged_into_supplier_id
       from suppliers parent
       join ancestry on parent.id = ancestry.merged_into_supplier_id
       where parent.pharmacy_id = $1
     ), canonical(id) as (
       select id from ancestry where merged_into_supplier_id is null limit 1
     ), aliases(id) as (
       select id from canonical
       union
       select supplier_row.id from suppliers supplier_row
       join aliases on supplier_row.merged_into_supplier_id = aliases.id
       where supplier_row.pharmacy_id = $1
     )
     select posted_row.id from posted_purchases posted_row
     left join lateral (
       select supplier_id, supplier_invoice_number
       from posted_purchase_adjustments
       where pharmacy_id = posted_row.pharmacy_id
         and original_purchase_id = posted_row.id
       order by suffix_value desc limit 1
     ) correction on true
     where posted_row.pharmacy_id = $1
       and ($4::uuid is null or posted_row.id <> $4)
       and coalesce(correction.supplier_id, posted_row.supplier_id) in (select id from aliases)
       and coalesce(correction.supplier_invoice_number, posted_row.supplier_invoice_number) = $3
     order by posted_row.posted_at, posted_row.id`,
    [pharmacyId, supplierId, supplierInvoiceNumber, excludedOriginalPurchaseId],
  );
  return duplicate.rows.map((row) => row.id);
}
