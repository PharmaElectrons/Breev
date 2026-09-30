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
/** SQL consumers may join only this published, immutable Purchasing projection. */
export const PURCHASE_REPORT_SOURCE_PROJECTION = "purchasing_report_sources";
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
     select projection.id, projection.ordinal, projection.item, projection.unit,
            projection.business_date::text as "businessDate",
            projection.original_document_id as "originalDocumentId", projection.label
     from requested source join ${PURCHASE_REPORT_SOURCE_PROJECTION} projection
       on projection.pharmacy_id = $1 and projection.id = source.id
      and projection.type = source.type and projection.ordinal = source.ordinal`,
    [pharmacyId, JSON.stringify(sources)],
  );
  return new Map(result.rows.map((row) => [reportSourceKey(row), row]));
}
