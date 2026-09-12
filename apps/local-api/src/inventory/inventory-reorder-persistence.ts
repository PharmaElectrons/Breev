import type { PoolClient } from "pg";

import type { ReorderProposalBasis } from "./inventory-reorder.js";

export type ReorderItemStatus = "basket" | "ordered" | "removed";

export interface ReorderItemRecord {
  readonly addedAt: string;
  readonly addedBy: string;
  readonly balanceAtProposal: string;
  readonly deviceId: string;
  readonly id: string;
  readonly maximumLevelAtProposal: string | null;
  readonly orderedAt: string | null;
  readonly orderedBy: string | null;
  readonly pharmacyId: string;
  readonly productId: string;
  readonly proposedAt: string;
  readonly proposedQuantity: string;
  readonly proposalBasis: ReorderProposalBasis;
  readonly quantity: string;
  readonly quantityEditedAt: string | null;
  readonly removedAt: string | null;
  readonly removedBy: string | null;
  readonly status: ReorderItemStatus;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly version: string;
}

interface ReorderItemRow {
  readonly added_at: string;
  readonly added_by: string;
  readonly balance_at_proposal: string;
  readonly device_id: string;
  readonly id: string;
  readonly maximum_level_at_proposal: string | null;
  readonly ordered_at: string | null;
  readonly ordered_by: string | null;
  readonly pharmacy_id: string;
  readonly product_id: string;
  readonly proposed_at: string;
  readonly proposed_quantity: string;
  readonly proposal_basis: ReorderProposalBasis;
  readonly quantity: string;
  readonly quantity_edited_at: string | null;
  readonly removed_at: string | null;
  readonly removed_by: string | null;
  readonly status: ReorderItemStatus;
  readonly updated_at: string;
  readonly updated_by: string;
  readonly version: string;
}

const REORDER_ITEM_COLUMNS = `
  id, pharmacy_id, product_id, status, version::text, quantity::text,
  proposed_quantity::text, proposal_basis, balance_at_proposal::text,
  maximum_level_at_proposal::text, proposed_at::text,
  quantity_edited_at::text, added_at::text, added_by, ordered_at::text,
  ordered_by, removed_at::text, removed_by, updated_at::text, updated_by,
  device_id`;

export async function lockLiveReorderItemForProduct(
  client: PoolClient,
  pharmacyId: string,
  productId: string,
): Promise<ReorderItemRecord | undefined> {
  const result = await client.query<ReorderItemRow>(
    `select ${REORDER_ITEM_COLUMNS}
     from inventory_reorder_items
     where pharmacy_id = $1 and product_id = $2 and status <> 'removed'
     for update`,
    [pharmacyId, productId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : mapReorderItem(row);
}

export async function insertReorderItem(
  client: PoolClient,
  input: {
    readonly addedBy: string;
    readonly balanceAtProposal: bigint;
    readonly deviceId: string;
    readonly maximumLevelAtProposal: bigint | null;
    readonly pharmacyId: string;
    readonly productId: string;
    readonly proposedQuantity: bigint;
    readonly proposalBasis: ReorderProposalBasis;
    readonly quantity: bigint;
    readonly updatedBy: string;
  },
): Promise<ReorderItemRecord> {
  const result = await client.query<ReorderItemRow>(
    `insert into inventory_reorder_items (
       pharmacy_id, product_id, quantity, proposed_quantity, proposal_basis,
       balance_at_proposal, maximum_level_at_proposal, added_by, updated_by,
       device_id
     ) values ($1, $2, $3::bigint, $4::bigint, $5, $6::bigint, $7::bigint,
               $8, $9, $10)
     returning ${REORDER_ITEM_COLUMNS}`,
    [
      input.pharmacyId,
      input.productId,
      input.quantity.toString(),
      input.proposedQuantity.toString(),
      input.proposalBasis,
      input.balanceAtProposal.toString(),
      input.maximumLevelAtProposal?.toString() ?? null,
      input.addedBy,
      input.updatedBy,
      input.deviceId,
    ],
  );
  return requireReorderItem(result.rows[0], "The Reorder Item was not added");
}

export async function refreshReorderProposal(
  client: PoolClient,
  input: {
    readonly balanceAtProposal: bigint;
    readonly deviceId: string;
    readonly id: string;
    readonly maximumLevelAtProposal: bigint | null;
    readonly pharmacyId: string;
    readonly proposedQuantity: bigint;
    readonly proposalBasis: ReorderProposalBasis;
    readonly quantity: bigint;
    readonly updatedBy: string;
  },
): Promise<ReorderItemRecord> {
  const result = await client.query<ReorderItemRow>(
    `update inventory_reorder_items
     set quantity = $3::bigint, proposed_quantity = $4::bigint,
         proposal_basis = $5, balance_at_proposal = $6::bigint,
         maximum_level_at_proposal = $7::bigint,
         proposed_at = statement_timestamp(), version = version + 1,
         updated_at = statement_timestamp(), updated_by = $8, device_id = $9
     where pharmacy_id = $1 and id = $2 and status = 'basket'
     returning ${REORDER_ITEM_COLUMNS}`,
    [
      input.pharmacyId,
      input.id,
      input.quantity.toString(),
      input.proposedQuantity.toString(),
      input.proposalBasis,
      input.balanceAtProposal.toString(),
      input.maximumLevelAtProposal?.toString() ?? null,
      input.updatedBy,
      input.deviceId,
    ],
  );
  return requireReorderItem(
    result.rows[0],
    "The Reorder Item proposal was not refreshed",
  );
}

export async function lockReorderItem(
  client: PoolClient,
  pharmacyId: string,
  itemId: string,
): Promise<ReorderItemRecord | undefined> {
  const result = await client.query<ReorderItemRow>(
    `select ${REORDER_ITEM_COLUMNS}
     from inventory_reorder_items
     where pharmacy_id = $1 and id = $2 and status <> 'removed'
     for update`,
    [pharmacyId, itemId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : mapReorderItem(row);
}

export async function listReorderItems(
  client: PoolClient,
  pharmacyId: string,
  status?: Exclude<ReorderItemStatus, "removed">,
): Promise<readonly ReorderItemRecord[]> {
  const result = await client.query<ReorderItemRow>(
    `select ${REORDER_ITEM_COLUMNS}
     from inventory_reorder_items
     where pharmacy_id = $1
       and status <> 'removed'
       and ($2::text is null or status::text = $2::text)
     order by added_at, id`,
    [pharmacyId, status ?? null],
  );
  return result.rows.map(mapReorderItem);
}

export async function updateReorderQuantity(
  client: PoolClient,
  input: {
    readonly deviceId: string;
    readonly id: string;
    readonly pharmacyId: string;
    readonly quantity: bigint;
    readonly updatedBy: string;
  },
): Promise<ReorderItemRecord> {
  const result = await client.query<ReorderItemRow>(
    `update inventory_reorder_items
     set quantity = $3::bigint, quantity_edited_at = statement_timestamp(),
         version = version + 1, updated_at = statement_timestamp(),
         updated_by = $4, device_id = $5
     where pharmacy_id = $1 and id = $2
     returning ${REORDER_ITEM_COLUMNS}`,
    [
      input.pharmacyId,
      input.id,
      input.quantity.toString(),
      input.updatedBy,
      input.deviceId,
    ],
  );
  return requireReorderItem(
    result.rows[0],
    "The Reorder Item quantity was not updated",
  );
}

export async function markReorderItemRemoved(
  client: PoolClient,
  input: {
    readonly deviceId: string;
    readonly id: string;
    readonly pharmacyId: string;
    readonly removedBy: string;
  },
): Promise<ReorderItemRecord> {
  const result = await client.query<ReorderItemRow>(
    `update inventory_reorder_items
     set status = 'removed', removed_at = statement_timestamp(),
         removed_by = $3, version = version + 1,
         updated_at = statement_timestamp(), updated_by = $3, device_id = $4
     where pharmacy_id = $1 and id = $2 and status = 'basket'
     returning ${REORDER_ITEM_COLUMNS}`,
    [input.pharmacyId, input.id, input.removedBy, input.deviceId],
  );
  return requireReorderItem(result.rows[0], "The Reorder Item was not removed");
}

export async function markReorderItemOrdered(
  client: PoolClient,
  input: {
    readonly deviceId: string;
    readonly id: string;
    readonly pharmacyId: string;
    readonly orderedBy: string;
  },
): Promise<ReorderItemRecord> {
  const result = await client.query<ReorderItemRow>(
    `update inventory_reorder_items
     set status = 'ordered', ordered_at = statement_timestamp(),
         ordered_by = $3, version = version + 1,
         updated_at = statement_timestamp(), updated_by = $3, device_id = $4
     where pharmacy_id = $1 and id = $2 and status = 'basket'
     returning ${REORDER_ITEM_COLUMNS}`,
    [input.pharmacyId, input.id, input.orderedBy, input.deviceId],
  );
  return requireReorderItem(result.rows[0], "The Reorder Item was not ordered");
}

export async function returnReorderItemToBasket(
  client: PoolClient,
  input: {
    readonly deviceId: string;
    readonly id: string;
    readonly pharmacyId: string;
    readonly updatedBy: string;
  },
): Promise<ReorderItemRecord> {
  const result = await client.query<ReorderItemRow>(
    `update inventory_reorder_items
     set status = 'basket', ordered_at = null, ordered_by = null,
         version = version + 1, updated_at = statement_timestamp(),
         updated_by = $3, device_id = $4
     where pharmacy_id = $1 and id = $2 and status = 'ordered'
     returning ${REORDER_ITEM_COLUMNS}`,
    [input.pharmacyId, input.id, input.updatedBy, input.deviceId],
  );
  return requireReorderItem(
    result.rows[0],
    "The Reorder Item was not returned to the basket",
  );
}

function mapReorderItem(row: ReorderItemRow): ReorderItemRecord {
  return {
    addedAt: isoDateTime(row.added_at),
    addedBy: row.added_by,
    balanceAtProposal: row.balance_at_proposal,
    deviceId: row.device_id,
    id: row.id,
    maximumLevelAtProposal: row.maximum_level_at_proposal,
    orderedAt: row.ordered_at === null ? null : isoDateTime(row.ordered_at),
    orderedBy: row.ordered_by,
    pharmacyId: row.pharmacy_id,
    productId: row.product_id,
    proposedAt: isoDateTime(row.proposed_at),
    proposedQuantity: row.proposed_quantity,
    proposalBasis: row.proposal_basis,
    quantity: row.quantity,
    quantityEditedAt:
      row.quantity_edited_at === null
        ? null
        : isoDateTime(row.quantity_edited_at),
    removedAt: row.removed_at === null ? null : isoDateTime(row.removed_at),
    removedBy: row.removed_by,
    status: row.status,
    updatedAt: isoDateTime(row.updated_at),
    updatedBy: row.updated_by,
    version: row.version,
  };
}

function requireReorderItem(
  row: ReorderItemRow | undefined,
  message: string,
): ReorderItemRecord {
  if (row === undefined) throw new Error(message);
  return mapReorderItem(row);
}

/** PostgreSQL spells `timestamptz::text` in its own format; the wire is ISO 8601. */
function isoDateTime(value: string): string {
  return new Date(value).toISOString();
}
