/**
 * Count-session arithmetic. This module is deliberately framework-free: the
 * Catalog owns packaging definitions, Inventory owns valuation and allocation,
 * and persistence/transport layers own only storage and wire validation.
 */

import {
  composeBaseUnits,
  type Packaging,
  type UnitQuantity,
  type UnitReference,
} from "../catalog/catalog-packaging.js";
import {
  VALUATION_SCALE,
  applyWeightedAverageDepletion,
  applyWeightedAverageReceipt,
  reportedAverageUnitCostScaled,
  type InventoryValuationState,
} from "./inventory-valuation.js";
import type { BatchFact, FefoAllocation } from "./inventory-fefo.js";
import {
  allocateFilsProportionally,
  divideFilsRounded,
  iqdFils,
} from "../posting/money.js";

export type CountEntry = UnitQuantity;

export type CountCompositionProblem =
  "entry-empty" | "entry-not-whole" | "unit-unknown";

export type CountCompositionOutcome =
  | {
      readonly ok: true;
      readonly countedQuantity: bigint;
      readonly enteredLabel: string;
    }
  | { readonly ok: false; readonly problem: CountCompositionProblem };

export function composeCountEntries(
  packaging: Packaging,
  entries: readonly CountEntry[],
): CountCompositionOutcome {
  if (entries.length === 0) {
    return { ok: false, problem: "entry-empty" };
  }

  const composed = composeBaseUnits(packaging, entries);
  if (!composed.ok) {
    return {
      ok: false,
      problem:
        composed.problem.code === "unknown-package-unit"
          ? "unit-unknown"
          : "entry-not-whole",
    };
  }

  const entered = entries
    .filter((entry) => entry.count > 0n)
    .map(
      (entry) => `${entry.count.toString()} ${unitName(packaging, entry.unit)}`,
    );
  return {
    ok: true,
    countedQuantity: composed.baseUnits,
    enteredLabel:
      entered.length === 0
        ? `0 ${packaging.inventoryUnitName}`
        : entered.join(" + "),
  };
}

export function countVariance(counted: bigint, before: bigint): bigint {
  return counted - before;
}

/** Selects the newest batch from the already eligibility-filtered candidates. */
export function pickSurplusBatch(
  allocatableFacts: readonly BatchFact[],
): BatchFact | null {
  const candidates = allocatableFacts.filter(
    (fact) =>
      fact.status === undefined ||
      fact.status === "eligible" ||
      fact.status === "near-expiry",
  );
  return (
    [...candidates].sort(
      (left, right) =>
        left.receivedAt.localeCompare(right.receivedAt) ||
        left.batchId.localeCompare(right.batchId),
    )[candidates.length - 1] ?? null
  );
}

export interface CountVarianceValue {
  readonly carryingAmountFils: bigint;
  readonly averageUnitCostScaled: bigint;
  readonly nextState: InventoryValuationState;
}

export type CountVarianceValueOutcome =
  CountVarianceValue | { readonly problem: "no-cost-basis" };

export function valueCountVariance(
  state: InventoryValuationState,
  variance: bigint,
): CountVarianceValueOutcome {
  if (variance === 0n) {
    throw new RangeError("A count variance to value cannot be zero");
  }
  if (state.totalQuantity <= 0n || state.totalQuantity < -variance) {
    return { problem: "no-cost-basis" };
  }
  const averageUnitCostScaled = reportedAverageUnitCostScaled(state);
  if (averageUnitCostScaled === null) {
    return { problem: "no-cost-basis" };
  }

  if (variance < 0n) {
    const depletion = applyWeightedAverageDepletion(state, {
      quantity: -variance,
    });
    return {
      averageUnitCostScaled,
      carryingAmountFils: -depletion.carryingAmountFils,
      nextState: depletion.state,
    };
  }

  const carryingAmountFils = divideFilsRounded(
    state.totalValueScaled * variance,
    state.totalQuantity * 10n ** BigInt(VALUATION_SCALE),
  );
  return {
    averageUnitCostScaled,
    carryingAmountFils,
    nextState: applyWeightedAverageReceipt(state, {
      carryingAmountFils,
      quantity: variance,
    }),
  };
}

export function splitCarryingAmount(
  total: bigint,
  allocations: readonly Pick<FefoAllocation, "quantity">[],
): readonly bigint[] {
  const weights = allocations.map((allocation) => allocation.quantity);
  const negative = total < 0n;
  const shares = allocateFilsProportionally(
    iqdFils(negative ? -total : total),
    weights,
  );
  return shares.map((share) => (negative ? -share : share));
}

function unitName(packaging: Packaging, unit: UnitReference): string {
  return unit.kind === "inventory-unit"
    ? packaging.inventoryUnitName
    : (packaging.packageUnits.find(
        (packageUnit) => packageUnit.name === unit.packageUnitName,
      )?.name ?? unit.packageUnitName);
}
