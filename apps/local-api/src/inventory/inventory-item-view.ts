import {
  inventoryItemSchema,
  type InventoryItem,
} from "@breev/contracts/local-rest";

import type { CatalogInventoryFacts } from "../catalog/catalog-inventory.js";
import type { InventoryPosition } from "./inventory-review.js";
import {
  automaticStateColour,
  consumptionRatePer30Days,
  effectiveStateColour,
  riskIndicators,
} from "./inventory-risk.js";
import {
  reportedAverageUnitCostScaled,
  VALUATION_SCALE,
} from "./inventory-valuation.js";
import { divideFilsRounded } from "../posting/money.js";

export function inventoryItemView(
  fact: CatalogInventoryFacts,
  position: InventoryPosition | undefined,
  valuationGranted: boolean,
  now: Date,
  businessDate: string,
  nearExpiryDays: number,
): InventoryItem {
  const balance = position?.balance ?? 0n;
  const indicators = riskIndicators({
    balance,
    coldStorageRequired: fact.coldStorageRequired,
    earliestExpiry: position?.earliestExpiry ?? null,
    expiredCount: position?.expiredCount ?? 0n,
    hasBarcode: fact.hasBarcode,
    maximumLevel: fact.stockLevels.maximumLevel,
    minimumLevel: fact.stockLevels.minimumLevel,
    businessDate,
    nearExpiryDays,
    reorderPoint: fact.stockLevels.reorderPoint,
  });
  const automatic = automaticStateColour(indicators);
  return inventoryItemSchema.parse({
    averageUnitCostFils: valuationGranted ? averageFils(position) : null,
    balance: balance.toString(),
    batches: {
      count: (position?.totalBatchCount ?? 0n).toString(),
      earliestExpiry: position?.earliestExpiry ?? null,
      expiredCount: (position?.expiredCount ?? 0n).toString(),
    },
    consumptionRatePer30Days: consumptionRatePer30Days(
      position?.movements ?? [],
      now,
    ).toString(),
    displayName: fact.displayName,
    productId: fact.productId,
    reconciliation: position?.reconciliation ?? "consistent",
    riskIndicators: indicators,
    stateColour: {
      automatic,
      effective: effectiveStateColour(fact.manualStateColour, automatic),
      manual: fact.manualStateColour,
    },
    status: fact.status,
    stockLevels: stockLevelsView(fact),
    valueFils: valuationGranted ? (position?.valueFils ?? 0n).toString() : null,
  });
}

export function includeInReview(
  fact: CatalogInventoryFacts,
  position: Pick<InventoryPosition, "balance"> | undefined,
): boolean {
  return (
    fact.status !== "merged" &&
    (fact.status !== "archived" || (position?.balance ?? 0n) !== 0n)
  );
}

export function averageFils(
  position: InventoryPosition | undefined,
): string | null {
  if (position === undefined) return null;
  const average = reportedAverageUnitCostScaled({
    totalQuantity: position.valuationQuantity,
    totalValueScaled: position.valuationValueScaled,
  });
  return average === null
    ? null
    : divideFilsRounded(average, 10n ** BigInt(VALUATION_SCALE)).toString();
}

export function stockLevelsView(fact: CatalogInventoryFacts): {
  readonly maximumLevel: string | null;
  readonly minimumLevel: string | null;
  readonly reorderPoint: string | null;
} {
  return {
    maximumLevel: fact.stockLevels.maximumLevel?.toString() ?? null,
    minimumLevel: fact.stockLevels.minimumLevel?.toString() ?? null,
    reorderPoint: fact.stockLevels.reorderPoint?.toString() ?? null,
  };
}
