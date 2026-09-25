import type { PoolClient } from "pg";

export type SaleDraftStatus = "active" | "suspended" | "discarded";

export interface SaleDraftRecord {
  readonly createdAt: string;
  readonly createdBy: string;
  readonly deviceId: string;
  readonly id: string;
  readonly invoiceDiscountFils: string;
  readonly pharmacyId: string;
  readonly status: SaleDraftStatus;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly version: string;
}

interface SaleDraftRow {
  readonly created_at: string;
  readonly created_by: string;
  readonly device_id: string;
  readonly id: string;
  readonly invoice_discount_fils: string;
  readonly pharmacy_id: string;
  readonly status: SaleDraftStatus;
  readonly updated_at: string;
  readonly updated_by: string;
  readonly version: string;
}

const SALE_DRAFT_COLUMNS = `
  id, pharmacy_id, status, version::text, invoice_discount_fils::text,
  created_at::text, created_by,
  updated_at::text, updated_by, device_id`;

export async function insertSaleDraft(
  client: PoolClient,
  input: {
    readonly createdBy: string;
    readonly deviceId: string;
    readonly pharmacyId: string;
    readonly updatedBy: string;
  },
): Promise<SaleDraftRecord> {
  const result = await client.query<SaleDraftRow>(
    `insert into sale_drafts (
       pharmacy_id, created_by, updated_by, device_id
     ) values ($1, $2, $3, $4)
     returning ${SALE_DRAFT_COLUMNS}`,
    [input.pharmacyId, input.createdBy, input.updatedBy, input.deviceId],
  );
  return requireSaleDraft(result.rows[0], "The Sale Draft was not created");
}

export async function lockSaleDraft(
  client: PoolClient,
  pharmacyId: string,
  draftId: string,
): Promise<SaleDraftRecord | undefined> {
  const result = await client.query<SaleDraftRow>(
    `select ${SALE_DRAFT_COLUMNS}
     from sale_drafts
     where pharmacy_id = $1 and id = $2
     for update`,
    [pharmacyId, draftId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : mapSaleDraft(row);
}

export async function readSaleDraft(
  client: PoolClient,
  pharmacyId: string,
  draftId: string,
): Promise<SaleDraftRecord | undefined> {
  const result = await client.query<SaleDraftRow>(
    `select ${SALE_DRAFT_COLUMNS}
     from sale_drafts
     where pharmacy_id = $1 and id = $2`,
    [pharmacyId, draftId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : mapSaleDraft(row);
}

export async function listSaleDrafts(
  client: PoolClient,
  pharmacyId: string,
  status?: SaleDraftStatus,
): Promise<readonly SaleDraftRecord[]> {
  const result = await client.query<SaleDraftRow>(
    `select ${SALE_DRAFT_COLUMNS}
     from sale_drafts
     where pharmacy_id = $1
       and ($2::text is null or status::text = $2::text)
     order by updated_at desc, id`,
    [pharmacyId, status ?? null],
  );
  return result.rows.map(mapSaleDraft);
}

export async function touchSaleDraft(
  client: PoolClient,
  input: {
    readonly deviceId: string;
    readonly id: string;
    readonly pharmacyId: string;
    readonly updatedBy: string;
    readonly status?: SaleDraftStatus;
    readonly invoiceDiscountFils?: string;
  },
): Promise<SaleDraftRecord> {
  const result = await client.query<SaleDraftRow>(
    `update sale_drafts
     set version = version + 1, updated_at = statement_timestamp(),
         updated_by = $3, device_id = $4,
         status = coalesce($5, status),
         invoice_discount_fils = coalesce($6::bigint, invoice_discount_fils)
     where pharmacy_id = $1 and id = $2
     returning ${SALE_DRAFT_COLUMNS}`,
    [
      input.pharmacyId,
      input.id,
      input.updatedBy,
      input.deviceId,
      input.status ?? null,
      input.invoiceDiscountFils ?? null,
    ],
  );
  return requireSaleDraft(result.rows[0], "The Sale Draft was not resumed");
}

function mapSaleDraft(row: SaleDraftRow): SaleDraftRecord {
  return {
    createdAt: isoDateTime(row.created_at),
    createdBy: row.created_by,
    deviceId: row.device_id,
    id: row.id,
    invoiceDiscountFils: row.invoice_discount_fils,
    pharmacyId: row.pharmacy_id,
    status: row.status,
    updatedAt: isoDateTime(row.updated_at),
    updatedBy: row.updated_by,
    version: row.version,
  };
}

function requireSaleDraft(
  row: SaleDraftRow | undefined,
  message: string,
): SaleDraftRecord {
  if (row === undefined) throw new Error(message);
  return mapSaleDraft(row);
}

/** PostgreSQL spells `timestamptz::text` in its own format; the wire is ISO 8601. */
function isoDateTime(value: string): string {
  return new Date(value).toISOString();
}
