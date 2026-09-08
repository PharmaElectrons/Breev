import { divideFilsRounded } from "../posting/money.js";

/**
 * Perpetual weighted-average cost, Phase One's single costing method.
 *
 * docs/domain.md §"Exact quantities, money, and accounting": "Phase One uses
 * one costing method: perpetual weighted-average cost (WAC) on the Primary
 * Supplier Cost. Last-purchase cost is reference/pricing data only. FEFO
 * physical picking remains independent of valuation." And: "WAC and allocation
 * intermediates keep exact higher precision. The system applies deterministic
 * accountant-approved rounding and remainder allocation only when it produces
 * posted fils."
 *
 * ## Why the state is a value and a quantity, and not an average
 *
 * The arithmetic is stated in the issue as
 * `new_total_value = old_total_value + received_base_qty × primary_unit_cost`,
 * `new_total_qty = old_total_qty + received_base_qty`, and
 * `new_average = new_total_value / new_total_qty`. Only the first two are
 * carried forward here. The average is derived on demand by
 * {@link reportedAverageUnitCostScaled} and is never an input to the next
 * receipt, so its rounding cannot accumulate: total value stays exactly the
 * sum of the Carrying Amounts that were frozen on the movements, whatever the
 * average happens to round to.
 *
 * ## Primary Supplier Cost only
 *
 * {@link InventoryReceipt} carries a `carryingAmountFils`, and the caller may
 * only ever pass the line's pre-discount Primary Supplier Cost. There is no
 * allowance percentage, no discount, and no Cost After Discount in this
 * module's interface, so the informational cost has no route into valuation
 * at all.
 *
 * Framework-free: no Nest, Drizzle, PostgreSQL, or transport type appears
 * here. Every value is an exact `bigint`.
 */

/** The one costing method Phase One implements. */
export const INVENTORY_VALUATION_METHOD = "weighted-average-cost" as const;

/**
 * The decimal places the valuation state and the reported average keep. Ten is
 * the "exact higher precision" the domain asks for between postings: a fils is
 * already a thousandth of a dinar, so a ten-place intermediate keeps an
 * average meaningful for quantities far beyond any pharmacy's stock.
 *
 * The persisted columns use the same scale, so nothing is rounded on the way
 * into or out of the database.
 */
export const VALUATION_SCALE = 10;

const VALUATION_UNIT = 10n ** BigInt(VALUATION_SCALE);

/**
 * A product's weighted-average state.
 *
 * `totalValueScaled` is fils multiplied by `10 ** VALUATION_SCALE`. Receipts
 * only ever add whole fils, so the scaled value is exact today; the scale is
 * there for the issues that consume the average -- COGS, returns, write-offs --
 * where a depletion is a fraction of a fils per unit.
 */
export interface InventoryValuationState {
  readonly totalQuantity: bigint;
  readonly totalValueScaled: bigint;
}

/** One received line, valued at its Primary Supplier Cost. */
export interface InventoryReceipt {
  /**
   * The line's frozen Carrying Amount in whole fils: its full nominal value
   * before any supplier allowance.
   */
  readonly carryingAmountFils: bigint;
  /** Inventory Units received. Positive: this is a receipt, not a movement. */
  readonly quantity: bigint;
}

/** A product Breev has never received: no quantity and no value. */
export const EMPTY_INVENTORY_VALUATION: InventoryValuationState = {
  totalQuantity: 0n,
  totalValueScaled: 0n,
};

/**
 * Adds one received line to a product's weighted-average state.
 *
 * Both additions are exact integer additions, so quantity and carrying amount
 * conserve by construction: after any sequence of receipts the total value is
 * the sum of the Carrying Amounts and the total quantity is the sum of the
 * received quantities, in any order.
 *
 * A non-positive quantity or a negative amount is a programming error rather
 * than user input -- the row grammar, the draft-row constraints, and
 * `calculatePurchaseCosts` have all already refused those -- so this throws
 * instead of returning an outcome a caller might ignore.
 */
export function applyWeightedAverageReceipt(
  state: InventoryValuationState,
  receipt: InventoryReceipt,
): InventoryValuationState {
  assertExact(state.totalQuantity, "A valuation quantity");
  assertExact(state.totalValueScaled, "A valuation value");
  assertExact(receipt.quantity, "A received quantity");
  assertExact(receipt.carryingAmountFils, "A Carrying Amount");
  if (receipt.quantity <= 0n) {
    throw new RangeError("A receipt must add a positive Inventory Unit count");
  }
  if (receipt.carryingAmountFils < 0n) {
    throw new RangeError("A Carrying Amount cannot be negative");
  }
  return {
    totalQuantity: state.totalQuantity + receipt.quantity,
    totalValueScaled:
      state.totalValueScaled + receipt.carryingAmountFils * VALUATION_UNIT,
  };
}

/**
 * The average cost of one Inventory Unit, in fils scaled by
 * `10 ** VALUATION_SCALE`, rounded by the module-wide halfway rule.
 *
 * Reported, not stored: it is recomputed from the state every time, so two
 * callers always see the same number and no caller can feed a rounded average
 * back into the state it came from. A product with no stock has no average
 * rather than an average of zero, which is why this returns `null` -- zero is a
 * cost, and reporting one for stock that does not exist would let a later COGS
 * value a depletion at nothing.
 */
export function reportedAverageUnitCostScaled(
  state: InventoryValuationState,
): bigint | null {
  assertExact(state.totalQuantity, "A valuation quantity");
  assertExact(state.totalValueScaled, "A valuation value");
  if (state.totalQuantity <= 0n) return null;
  return divideFilsRounded(state.totalValueScaled, state.totalQuantity);
}

/**
 * The whole-fils value of a valuation state, for the one place a scaled value
 * has to meet a `bigint` money column or an assertion about conserved value.
 */
export function valuationValueFils(state: InventoryValuationState): bigint {
  assertExact(state.totalValueScaled, "A valuation value");
  return divideFilsRounded(state.totalValueScaled, VALUATION_UNIT);
}

function assertExact(value: bigint, label: string): void {
  if (typeof value !== "bigint") {
    throw new TypeError(
      `${label} must be an exact bigint, received ${typeof value}`,
    );
  }
}
