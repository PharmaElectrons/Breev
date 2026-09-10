import { calculatePurchaseCosts } from "./purchase-costs.js";

export const PURCHASE_ADJUSTMENT_REASONS = [
  "quantity error",
  "price error",
  "invoice-number error",
  "supplier error",
  "other",
] as const;

export type PurchaseAdjustmentReason =
  (typeof PURCHASE_ADJUSTMENT_REASONS)[number];

export interface PurchaseAdjustmentHeaderSnapshot {
  readonly supplierId: string;
  readonly supplierInvoiceNumber: string;
}

export interface PurchaseAdjustmentRowSnapshot {
  readonly enteredQuantity: bigint;
  readonly inventoryUnitQuantity: bigint;
  readonly itemDisplayName: string;
  readonly itemId: string;
  /** Stable across successive adjustments, including rows added by one. */
  readonly lineageId: string;
  /** Null only when an earlier adjustment introduced the row. */
  readonly originalRowId: string | null;
  readonly primarySupplierCostFils: bigint;
  readonly retailPriceFils: bigint;
}

export interface PriorPurchaseAdjustmentEffect {
  readonly lineageId: string;
  readonly primarySupplierCostDeltaFils: bigint;
  readonly quantityDelta: bigint;
}

export type PurchaseAdjustmentField =
  | "entered-quantity"
  | "primary-supplier-cost"
  | "retail-price"
  | "supplier"
  | "supplier-invoice-number";

export interface PurchaseAdjustmentFieldChange {
  readonly after: string | null;
  readonly before: string | null;
  readonly field: PurchaseAdjustmentField;
}

export interface PurchaseAdjustmentRowDelta {
  readonly after: PurchaseAdjustmentRowSnapshot | null;
  readonly before: PurchaseAdjustmentRowSnapshot | null;
  readonly changes: readonly PurchaseAdjustmentFieldChange[];
  readonly kind: "added" | "changed" | "removed";
  readonly lineageId: string;
  /** The effect this posting adds now, after prior adjustment effects. */
  readonly primarySupplierCostDeltaFils: bigint;
  /** The movement this posting adds now, after prior adjustment movements. */
  readonly quantityDelta: bigint;
}

export interface PurchaseAdjustmentDelta {
  readonly allowanceDeltaFils: bigint;
  readonly costAfterDiscountDeltaFils: bigint;
  readonly headerChanges: readonly PurchaseAdjustmentFieldChange[];
  readonly primarySupplierCostDeltaFils: bigint;
  readonly quantityDelta: bigint;
  readonly rowDeltas: readonly PurchaseAdjustmentRowDelta[];
}

export interface ExtractPurchaseAdjustmentDeltaInput {
  readonly allowancePercentage: string;
  readonly correctedHeader: PurchaseAdjustmentHeaderSnapshot;
  readonly correctedRows: readonly PurchaseAdjustmentRowSnapshot[];
  readonly originalHeader: PurchaseAdjustmentHeaderSnapshot;
  readonly originalRows: readonly PurchaseAdjustmentRowSnapshot[];
  readonly priorAllowanceDeltaFils: bigint;
  readonly priorCostAfterDiscountDeltaFils: bigint;
  readonly priorEffects: readonly PriorPurchaseAdjustmentEffect[];
  readonly priorPrimarySupplierCostDeltaFils: bigint;
}

export type ExtractPurchaseAdjustmentDeltaOutcome =
  | { readonly delta: PurchaseAdjustmentDelta; readonly ok: true }
  | {
      readonly ok: false;
      readonly problem:
        "duplicate-lineage" | "invalid-costs" | "invalid-prior-effect";
    };

/**
 * Extracts the adjustment against the immutable original, then subtracts the
 * effects already posted for the same lineages. That second step is what lets
 * A02 stand on its own: if A01 changed 4 to 8 and A02 leaves that reconstructed
 * row at 8, A02 produces no movement; changing it to 6 produces exactly -2.
 */
export function extractPurchaseAdjustmentDelta(
  input: ExtractPurchaseAdjustmentDeltaInput,
): ExtractPurchaseAdjustmentDeltaOutcome {
  const original = indexRows(input.originalRows);
  const corrected = indexRows(input.correctedRows);
  if (original === null || corrected === null) {
    return { ok: false, problem: "duplicate-lineage" };
  }

  const prior = new Map<
    string,
    { primarySupplierCostDeltaFils: bigint; quantityDelta: bigint }
  >();
  for (const effect of input.priorEffects) {
    if (!original.has(effect.lineageId) && !corrected.has(effect.lineageId)) {
      return { ok: false, problem: "invalid-prior-effect" };
    }
    const existing = prior.get(effect.lineageId) ?? {
      primarySupplierCostDeltaFils: 0n,
      quantityDelta: 0n,
    };
    prior.set(effect.lineageId, {
      primarySupplierCostDeltaFils:
        existing.primarySupplierCostDeltaFils +
        effect.primarySupplierCostDeltaFils,
      quantityDelta: existing.quantityDelta + effect.quantityDelta,
    });
  }

  const originalCosts = calculatePurchaseCosts(
    input.originalRows.map((row) => ({
      enteredQuantity: row.enteredQuantity,
      primarySupplierCostFils: row.primarySupplierCostFils,
    })),
    input.allowancePercentage,
  );
  const correctedCosts =
    input.correctedRows.length === 0
      ? {
          costs: {
            allowanceFils: 0n,
            costAfterDiscountFils: 0n,
            lines: [],
            primarySupplierCostFils: 0n,
          },
          ok: true as const,
        }
      : calculatePurchaseCosts(
          input.correctedRows.map((row) => ({
            enteredQuantity: row.enteredQuantity,
            primarySupplierCostFils: row.primarySupplierCostFils,
          })),
          input.allowancePercentage,
        );
  if (!originalCosts.ok || !correctedCosts.ok) {
    return { ok: false, problem: "invalid-costs" };
  }

  const lineages = new Set([...original.keys(), ...corrected.keys()]);
  const rowDeltas: PurchaseAdjustmentRowDelta[] = [];
  let quantityDelta = 0n;
  for (const lineageId of lineages) {
    const before = original.get(lineageId) ?? null;
    const after = corrected.get(lineageId) ?? null;
    const priorEffect = prior.get(lineageId) ?? {
      primarySupplierCostDeltaFils: 0n,
      quantityDelta: 0n,
    };
    const targetQuantityDelta =
      (after?.inventoryUnitQuantity ?? 0n) -
      (before?.inventoryUnitQuantity ?? 0n);
    const targetValueDelta = lineValue(after) - lineValue(before);
    const postingQuantityDelta =
      targetQuantityDelta - priorEffect.quantityDelta;
    const postingValueDelta =
      targetValueDelta - priorEffect.primarySupplierCostDeltaFils;
    const isNetNoop = postingQuantityDelta === 0n && postingValueDelta === 0n;
    if (
      isNetNoop &&
      (before === null ||
        after === null ||
        before.retailPriceFils === after.retailPriceFils)
    ) {
      continue;
    }
    const changes = rowChanges(before, after);
    if (
      changes.length === 0 &&
      postingQuantityDelta === 0n &&
      postingValueDelta === 0n
    ) {
      continue;
    }
    rowDeltas.push({
      after,
      before,
      changes,
      kind: before === null ? "added" : after === null ? "removed" : "changed",
      lineageId,
      primarySupplierCostDeltaFils: postingValueDelta,
      quantityDelta: postingQuantityDelta,
    });
    quantityDelta += postingQuantityDelta;
  }

  const headerChanges: PurchaseAdjustmentFieldChange[] = [];
  if (input.originalHeader.supplierId !== input.correctedHeader.supplierId) {
    headerChanges.push({
      after: input.correctedHeader.supplierId,
      before: input.originalHeader.supplierId,
      field: "supplier",
    });
  }
  if (
    input.originalHeader.supplierInvoiceNumber !==
    input.correctedHeader.supplierInvoiceNumber
  ) {
    headerChanges.push({
      after: input.correctedHeader.supplierInvoiceNumber,
      before: input.originalHeader.supplierInvoiceNumber,
      field: "supplier-invoice-number",
    });
  }

  return {
    delta: {
      allowanceDeltaFils:
        correctedCosts.costs.allowanceFils -
        originalCosts.costs.allowanceFils -
        input.priorAllowanceDeltaFils,
      costAfterDiscountDeltaFils:
        correctedCosts.costs.costAfterDiscountFils -
        originalCosts.costs.costAfterDiscountFils -
        input.priorCostAfterDiscountDeltaFils,
      headerChanges,
      primarySupplierCostDeltaFils:
        correctedCosts.costs.primarySupplierCostFils -
        originalCosts.costs.primarySupplierCostFils -
        input.priorPrimarySupplierCostDeltaFils,
      quantityDelta,
      rowDeltas,
    },
    ok: true,
  };
}

export function isEmptyPurchaseAdjustmentDelta(
  delta: PurchaseAdjustmentDelta,
): boolean {
  return delta.headerChanges.length === 0 && delta.rowDeltas.length === 0;
}

function indexRows(
  rows: readonly PurchaseAdjustmentRowSnapshot[],
): ReadonlyMap<string, PurchaseAdjustmentRowSnapshot> | null {
  const result = new Map<string, PurchaseAdjustmentRowSnapshot>();
  for (const row of rows) {
    if (result.has(row.lineageId)) return null;
    result.set(row.lineageId, row);
  }
  return result;
}

function lineValue(row: PurchaseAdjustmentRowSnapshot | null): bigint {
  return row === null ? 0n : row.enteredQuantity * row.primarySupplierCostFils;
}

function rowChanges(
  before: PurchaseAdjustmentRowSnapshot | null,
  after: PurchaseAdjustmentRowSnapshot | null,
): PurchaseAdjustmentFieldChange[] {
  if (before === null && after !== null) {
    return [
      {
        after: after.enteredQuantity.toString(),
        before: null,
        field: "entered-quantity",
      },
    ];
  }
  if (before !== null && after === null) {
    return [
      {
        after: null,
        before: before.enteredQuantity.toString(),
        field: "entered-quantity",
      },
    ];
  }
  if (before === null || after === null) return [];
  const changes: PurchaseAdjustmentFieldChange[] = [];
  if (before.enteredQuantity !== after.enteredQuantity) {
    changes.push({
      after: after.enteredQuantity.toString(),
      before: before.enteredQuantity.toString(),
      field: "entered-quantity",
    });
  }
  if (before.primarySupplierCostFils !== after.primarySupplierCostFils) {
    changes.push({
      after: after.primarySupplierCostFils.toString(),
      before: before.primarySupplierCostFils.toString(),
      field: "primary-supplier-cost",
    });
  }
  if (before.retailPriceFils !== after.retailPriceFils) {
    changes.push({
      after: after.retailPriceFils.toString(),
      before: before.retailPriceFils.toString(),
      field: "retail-price",
    });
  }
  return changes;
}
