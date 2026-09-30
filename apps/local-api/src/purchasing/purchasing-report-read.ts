import type { PoolClient } from "pg";

/** Published immutable display/business-date facts. Corrections retain their own identity. */
export interface PurchaseReportSource {
  readonly id: string;
  readonly type: "purchase-invoice" | "purchase-adjustment" | "purchase-return";
  readonly ordinal: number;
}
export interface PurchaseReportMetadata {
  readonly item: string | null;
  readonly unit: string | null;
  readonly businessDate: string | null;
  readonly label: string;
  readonly originalDocumentId: string | null;
}
export function reportSourceKey(source: {
  readonly id: string;
  readonly ordinal: number;
}): string {
  return `${source.id}:${source.ordinal}`;
}
export async function readPurchaseReportMetadata(
  client: PoolClient,
  pharmacyId: string,
  sources: readonly PurchaseReportSource[],
): Promise<ReadonlyMap<string, PurchaseReportMetadata>> {
  if (sources.length === 0) return new Map();
  const result = await client.query<
    PurchaseReportMetadata & { id: string; ordinal: number }
  >(
    `with requested as (
       select * from jsonb_to_recordset($2::jsonb) as source(id uuid, type text, ordinal integer)
     )
     select document.id, source.ordinal, row.item_display_name as item, row.inventory_unit_name as unit,
            document.invoice_date::text as "businessDate", null::uuid as "originalDocumentId",
            'P' || document.number_value || '/' || document.number_year as label
     from requested source
     join posted_purchases document on source.type = 'purchase-invoice' and document.id = source.id and document.pharmacy_id = $1
     join posted_purchase_rows row on row.posted_purchase_id = document.id and row.pharmacy_id = $1 and row.ordinal = source.ordinal
     union all
     select document.id, source.ordinal,
            coalesce(row.after_snapshot ->> 'itemDisplayName', row.before_snapshot ->> 'itemDisplayName'),
            coalesce(row.after_snapshot ->> 'inventoryUnitName', row.before_snapshot ->> 'inventoryUnitName'),
            null::text, document.original_purchase_id,
            'P' || original.number_value || '/' || original.number_year || '-A' || lpad(document.suffix_value::text, 2, '0')
     from requested source
     join posted_purchase_adjustments document on source.type = 'purchase-adjustment' and document.id = source.id and document.pharmacy_id = $1
     join posted_purchases original on original.id = document.original_purchase_id and original.pharmacy_id = $1
     join posted_purchase_adjustment_rows row on row.adjustment_id = document.id and row.pharmacy_id = $1 and row.ordinal = source.ordinal
     union all
     select document.id, source.ordinal, row.item_display_name, row.inventory_unit_name,
            null::text, document.original_purchase_id,
            'PR' || document.number_value || '/' || document.number_year
     from requested source
     join posted_purchase_returns document on source.type = 'purchase-return' and document.id = source.id and document.pharmacy_id = $1
     join posted_purchase_return_rows row on row.purchase_return_id = document.id and row.pharmacy_id = $1 and row.ordinal = source.ordinal`,
    [pharmacyId, JSON.stringify(sources)],
  );
  return new Map(result.rows.map((row) => [reportSourceKey(row), row]));
}
