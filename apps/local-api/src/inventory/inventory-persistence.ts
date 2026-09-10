import type { PoolClient } from "pg";

import {
  VALUATION_SCALE,
  applyWeightedAverageReceipt,
  type InventoryReceipt,
  type InventoryValuationState,
} from "./inventory-valuation.js";
import {
  DEFAULT_RECEIPT_CLASS_RULES,
  INVENTORY_RECEIPT_CLASSES,
  type InventoryReceiptClass,
  type InventoryReceiptRule,
  type InventoryReceiptRuleSet,
} from "./inventory-receipt-rules.js";

/**
 * Inventory's own transaction-aware persistence: batches, movements, and the
 * weighted-average valuation state. Every function here accepts the caller's
 * `PoolClient` and writes only tables Inventory owns (docs/architecture.md
 * §"Local module ownership"). No function opens or commits a transaction of
 * its own, and none imports Nest, Drizzle, or any transport type.
 */

/** Ensures a pharmacy has a configured rule for every receipt class, seeded
 * from {@link DEFAULT_RECEIPT_CLASS_RULES} on first use, then returns the
 * pharmacy's current configured set. A pharmacy that later edits its own
 * rules (a future feature) reads its edited values through this same
 * function; nothing here distinguishes a default row from an edited one. */
export async function resolveReceiptClassRuleSet(
  client: PoolClient,
  pharmacyId: string,
): Promise<InventoryReceiptRuleSet> {
  await client.query(
    `insert into inventory_receipt_class_rules (
       pharmacy_id, class, expiry_required, lot_required
     )
     select $1, class_row.class::inventory_receipt_class,
            class_row.expiry_required, class_row.lot_required
     from (values
       ('general-item', false, false),
       ('general-item-cold-chain', true, false),
       ('medication', true, false),
       ('medication-cold-chain', true, true)
     ) as class_row(class, expiry_required, lot_required)
     on conflict (pharmacy_id, class) do nothing`,
    [pharmacyId],
  );
  const result = await client.query<{
    class: string;
    expiry_required: boolean;
    lot_required: boolean;
  }>(
    `select class, expiry_required, lot_required
     from inventory_receipt_class_rules
     where pharmacy_id = $1`,
    [pharmacyId],
  );
  const rules: Record<InventoryReceiptClass, InventoryReceiptRule> = {
    ...DEFAULT_RECEIPT_CLASS_RULES,
  };
  const classes: readonly string[] = INVENTORY_RECEIPT_CLASSES;
  for (const row of result.rows) {
    if (!classes.includes(row.class)) continue;
    rules[row.class as InventoryReceiptClass] = {
      expiryRequired: row.expiry_required,
      lotRequired: row.lot_required,
    };
  }
  return rules;
}

export interface ReceiveBatchInput {
  readonly actorId: string;
  readonly expiryDate: string | null;
  readonly lotNumber: string | null;
  readonly pharmacyId: string;
  readonly productId: string;
  readonly quantity: bigint;
}

/** Creates one new batch for a physical receipt. Batches are never merged in
 * this slice: one posted purchase row always creates exactly one batch. */
export async function receiveBatch(
  client: PoolClient,
  input: ReceiveBatchInput,
): Promise<{ batchId: string }> {
  const inserted = await client.query<{ id: string }>(
    `insert into inventory_batches (
       pharmacy_id, product_id, lot_number, expiry_date, quantity, created_by
     ) values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      input.pharmacyId,
      input.productId,
      input.lotNumber,
      input.expiryDate,
      input.quantity.toString(),
      input.actorId,
    ],
  );
  const batchId = inserted.rows[0]?.id;
  if (batchId === undefined) {
    throw new Error("The Inventory batch was not created");
  }
  return { batchId };
}

export interface RecordPurchaseReceiptMovementInput {
  readonly actorId: string;
  readonly batchId: string;
  readonly carryingAmountFils: bigint;
  readonly pharmacyId: string;
  readonly productId: string;
  readonly quantity: bigint;
  readonly sourceDocumentId: string;
  readonly sourceRowOrdinal: number;
}

/** Appends one purchase-receipt movement. Movements are append-only: this
 * inserts and never updates or deletes a row. */
export async function recordPurchaseReceiptMovement(
  client: PoolClient,
  input: RecordPurchaseReceiptMovementInput,
): Promise<{ movementId: string }> {
  const inserted = await client.query<{ id: string }>(
    `insert into inventory_movements (
       pharmacy_id, product_id, batch_id, reason, quantity, carrying_amount_fils,
       source_document_type, source_document_id, source_row_ordinal, created_by
     ) values ($1, $2, $3, 'purchase-receipt', $4, $5, 'purchase-invoice', $6, $7, $8)
     returning id`,
    [
      input.pharmacyId,
      input.productId,
      input.batchId,
      input.quantity.toString(),
      input.carryingAmountFils.toString(),
      input.sourceDocumentId,
      input.sourceRowOrdinal,
      input.actorId,
    ],
  );
  const movementId = inserted.rows[0]?.id;
  if (movementId === undefined) {
    throw new Error("The Inventory movement was not created");
  }
  return { movementId };
}

/** Locks, updates, and returns one product's weighted-average valuation
 * state after one receipt. The row is created with an empty state on first
 * use, exactly like {@link resolveReceiptClassRuleSet} seeds its rules. */
export async function applyReceiptToValuation(
  client: PoolClient,
  pharmacyId: string,
  productId: string,
  receipt: InventoryReceipt,
): Promise<InventoryValuationState> {
  await client.query(
    `insert into inventory_valuation_state (pharmacy_id, product_id)
     values ($1, $2)
     on conflict (pharmacy_id, product_id) do nothing`,
    [pharmacyId, productId],
  );
  const locked = await client.query<{
    total_quantity: string;
    total_value_scaled: string;
  }>(
    `select total_quantity::text, total_value_scaled::text
     from inventory_valuation_state
     where pharmacy_id = $1 and product_id = $2
     for update`,
    [pharmacyId, productId],
  );
  const current = locked.rows[0];
  if (current === undefined) {
    throw new Error(
      "The Inventory valuation state disappeared inside its command",
    );
  }
  const before: InventoryValuationState = {
    totalQuantity: BigInt(current.total_quantity),
    totalValueScaled: BigInt(current.total_value_scaled),
  };
  const after = applyWeightedAverageReceipt(before, receipt);
  await client.query(
    `update inventory_valuation_state
     set total_quantity = $3::bigint, total_value_scaled = $4::numeric,
         updated_at = statement_timestamp()
     where pharmacy_id = $1 and product_id = $2`,
    [
      pharmacyId,
      productId,
      after.totalQuantity.toString(),
      after.totalValueScaled.toString(),
    ],
  );
  return after;
}

export interface PurchaseAdjustmentInventoryEffect {
  readonly batchId: string;
  readonly primarySupplierCostDeltaFils: bigint;
  readonly productId: string;
  readonly quantityDelta: bigint;
}

export type PurchaseAdjustmentBatchProblem =
  | { readonly batchId: string; readonly kind: "batch-invalid" }
  | {
      readonly availableQuantity: bigint;
      readonly batchId: string;
      readonly kind: "batch-insufficient";
      readonly requestedReduction: bigint;
    };

/** Locks every affected existing batch in id order and validates the summed
 * Delta against its current movement-derived balance. */
export async function validatePurchaseAdjustmentBatches(
  client: PoolClient,
  pharmacyId: string,
  effects: readonly PurchaseAdjustmentInventoryEffect[],
): Promise<PurchaseAdjustmentBatchProblem | undefined> {
  const byBatch = new Map<string, bigint>();
  const byBatchProduct = new Map<string, string>();
  for (const effect of effects) {
    const expectedProduct = byBatchProduct.get(effect.batchId);
    if (expectedProduct !== undefined && expectedProduct !== effect.productId) {
      return { batchId: effect.batchId, kind: "batch-invalid" };
    }
    byBatchProduct.set(effect.batchId, effect.productId);
    byBatch.set(
      effect.batchId,
      (byBatch.get(effect.batchId) ?? 0n) + effect.quantityDelta,
    );
  }
  const batchIds = [...byBatch.keys()].sort();
  if (batchIds.length === 0) return undefined;
  const locked = await client.query<{
    id: string;
    product_id: string;
    status: string;
  }>(
    `select id, product_id, status from inventory_batches
     where pharmacy_id = $1 and id = any($2::uuid[])
     order by id for update`,
    [pharmacyId, batchIds],
  );
  const batchFacts = new Map(locked.rows.map((row) => [row.id, row]));
  for (const batchId of batchIds) {
    const batch = batchFacts.get(batchId);
    if (
      batch?.status !== "active" ||
      batch.product_id !== byBatchProduct.get(batchId)
    ) {
      return { batchId, kind: "batch-invalid" };
    }
  }
  const balances = await client.query<{ batch_id: string; quantity: string }>(
    `select batch_id, coalesce(sum(quantity), 0)::text as quantity
     from inventory_movements
     where pharmacy_id = $1 and batch_id = any($2::uuid[])
     group by batch_id`,
    [pharmacyId, batchIds],
  );
  const current = new Map(
    balances.rows.map((row) => [row.batch_id, BigInt(row.quantity)]),
  );
  for (const batchId of batchIds) {
    const delta = byBatch.get(batchId) ?? 0n;
    const availableQuantity = current.get(batchId) ?? 0n;
    if (availableQuantity + delta < 0n) {
      return {
        availableQuantity,
        batchId,
        kind: "batch-insufficient",
        requestedReduction: -delta,
      };
    }
  }
  return undefined;
}

export async function recordPurchaseAdjustmentMovement(
  client: PoolClient,
  input: RecordPurchaseReceiptMovementInput,
): Promise<{ movementId: string }> {
  if (input.quantity === 0n) {
    throw new RangeError("An adjustment movement quantity cannot be zero");
  }
  const inserted = await client.query<{ id: string }>(
    `insert into inventory_movements (
       pharmacy_id, product_id, batch_id, reason, quantity, carrying_amount_fils,
       source_document_type, source_document_id, source_row_ordinal, created_by
     ) values ($1, $2, $3, 'purchase-adjustment', $4, $5,
               'purchase-adjustment', $6, $7, $8)
     returning id`,
    [
      input.pharmacyId,
      input.productId,
      input.batchId,
      input.quantity.toString(),
      input.carryingAmountFils.toString(),
      input.sourceDocumentId,
      input.sourceRowOrdinal,
      input.actorId,
    ],
  );
  const movementId = inserted.rows[0]?.id;
  if (movementId === undefined) {
    throw new Error("The Purchase Adjustment movement was not created");
  }
  return { movementId };
}

export async function recordPurchaseAdjustmentValueEffect(
  client: PoolClient,
  input: RecordPurchaseReceiptMovementInput,
): Promise<{ valueEffectId: string }> {
  if (input.quantity === 0n && input.carryingAmountFils === 0n) {
    throw new RangeError("An Inventory value effect cannot be empty");
  }
  const inserted = await client.query<{ id: string }>(
    `insert into inventory_value_effects (
       pharmacy_id, product_id, batch_id, quantity_delta,
       carrying_amount_delta_fils, source_document_type, source_document_id,
       source_row_ordinal, created_by
     ) values ($1, $2, $3, $4, $5, 'purchase-adjustment', $6, $7, $8)
     returning id`,
    [
      input.pharmacyId,
      input.productId,
      input.batchId,
      input.quantity.toString(),
      input.carryingAmountFils.toString(),
      input.sourceDocumentId,
      input.sourceRowOrdinal,
      input.actorId,
    ],
  );
  const valueEffectId = inserted.rows[0]?.id;
  if (valueEffectId === undefined) {
    throw new Error("The Purchase Adjustment value effect was not created");
  }
  return { valueEffectId };
}

export async function applyPurchaseAdjustmentToValuation(
  client: PoolClient,
  input: {
    readonly pharmacyId: string;
    readonly primarySupplierCostDeltaFils: bigint;
    readonly productId: string;
    readonly quantityDelta: bigint;
  },
): Promise<InventoryValuationState | undefined> {
  await client.query(
    `insert into inventory_valuation_state (pharmacy_id, product_id)
     values ($1, $2) on conflict (pharmacy_id, product_id) do nothing`,
    [input.pharmacyId, input.productId],
  );
  const locked = await client.query<{
    total_quantity: string;
    total_value_scaled: string;
  }>(
    `select total_quantity::text, total_value_scaled::text
     from inventory_valuation_state
     where pharmacy_id = $1 and product_id = $2 for update`,
    [input.pharmacyId, input.productId],
  );
  const current = locked.rows[0];
  if (current === undefined) {
    throw new Error("The Inventory valuation state disappeared");
  }
  const after = {
    totalQuantity: BigInt(current.total_quantity) + input.quantityDelta,
    totalValueScaled:
      BigInt(current.total_value_scaled) +
      input.primarySupplierCostDeltaFils * 10n ** BigInt(VALUATION_SCALE),
  };
  if (after.totalQuantity < 0n || after.totalValueScaled < 0n) {
    return undefined;
  }
  await client.query(
    `update inventory_valuation_state
     set total_quantity = $3::bigint, total_value_scaled = $4::numeric,
         updated_at = statement_timestamp()
     where pharmacy_id = $1 and product_id = $2`,
    [
      input.pharmacyId,
      input.productId,
      after.totalQuantity.toString(),
      after.totalValueScaled.toString(),
    ],
  );
  return after;
}

export async function validatePurchaseAdjustmentValuation(
  client: PoolClient,
  input: {
    readonly pharmacyId: string;
    readonly primarySupplierCostDeltaFils: bigint;
    readonly productId: string;
    readonly quantityDelta: bigint;
  },
): Promise<boolean> {
  const current = await client.query<{
    total_quantity: string;
    total_value_scaled: string;
  }>(
    `select total_quantity::text, total_value_scaled::text
     from inventory_valuation_state
     where pharmacy_id = $1 and product_id = $2`,
    [input.pharmacyId, input.productId],
  );
  const row = current.rows[0];
  const totalQuantity =
    BigInt(row?.total_quantity ?? "0") + input.quantityDelta;
  const totalValueScaled =
    BigInt(row?.total_value_scaled ?? "0") +
    input.primarySupplierCostDeltaFils * 10n ** BigInt(VALUATION_SCALE);
  return totalQuantity >= 0n && totalValueScaled >= 0n;
}
