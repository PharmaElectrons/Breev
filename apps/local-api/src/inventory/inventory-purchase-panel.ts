import type { PoolClient } from "pg";
import type { PurchaseItemDetails } from "@breev/contracts/local-rest";
import type {
  CatalogInventoryFacts,
  CatalogPackagingFacts,
} from "../catalog/catalog-inventory.js";
import { daysBetween } from "./business-date.js";
import { evaluateBatchEligibility } from "./inventory-eligibility.js";
import { readBatchFacts, readNearExpiryDays } from "./inventory-persistence.js";
import { readInventoryPositions } from "./inventory-review.js";
import { averageFils } from "./inventory-item-view.js";
import { riskIndicators } from "./inventory-risk.js";
import { DEFAULT_NEAR_EXPIRY_DAYS } from "./inventory-receipt-rules.js";

/** Exact inventory decomposition; a clinical third unit is never an input. */
export function inventoryUnitBreakdown(
  balance: bigint,
  packaging: CatalogPackagingFacts,
) {
  let remaining = balance;
  const units = [...packaging.packageUnits].sort((a, b) => {
    const left = BigInt(a.baseUnitsPerPackage),
      right = BigInt(b.baseUnitsPerPackage);
    return left > right ? -1 : left < right ? 1 : a.name.localeCompare(b.name);
  });
  const breakdown = units.map((unit) => {
    const ratio = BigInt(unit.baseUnitsPerPackage);
    const quantity = (remaining / ratio).toString();
    remaining %= ratio;
    return { name: unit.name, quantity };
  });
  return [
    ...breakdown,
    { name: packaging.inventoryUnitName, quantity: remaining.toString() },
  ];
}

/** Narrow transaction-aware Inventory read published to Purchasing. */
export async function readInventoryPurchasePanel(
  client: PoolClient,
  pharmacyId: string,
  fact: CatalogInventoryFacts,
  packaging: CatalogPackagingFacts,
  businessDate: string,
) {
  const thresholds = await readNearExpiryDays(client, pharmacyId);
  const nearExpiryDays =
    thresholds.get(fact.productId) ?? DEFAULT_NEAR_EXPIRY_DAYS;
  const position = (
    await readInventoryPositions(client, pharmacyId, businessDate, thresholds, {
      productIds: [fact.productId],
    })
  )[0];
  const balance = position?.balance ?? 0n;
  const batches = (
    await readBatchFacts(
      client,
      pharmacyId,
      { productIds: [fact.productId] },
      { lock: false },
    )
  )
    .filter((batch) => batch.balance > 0n)
    .sort(
      (a, b) =>
        (a.effectiveExpiryDate ?? "9999-12-31").localeCompare(
          b.effectiveExpiryDate ?? "9999-12-31",
        ) ||
        a.receivedAt.localeCompare(b.receivedAt) ||
        a.batchId.localeCompare(b.batchId),
    )
    .map((batch) => ({
      id: batch.batchId,
      balance: batch.balance.toString(),
      lotNumber: batch.lotNumber,
      originalExpiryDate: batch.originalExpiryDate,
      effectiveExpiryDate: batch.effectiveExpiryDate,
      daysRemaining:
        batch.effectiveExpiryDate === null
          ? null
          : daysBetween(businessDate, batch.effectiveExpiryDate),
      status: evaluateBatchEligibility({
        businessDate,
        effectiveExpiryDate: batch.effectiveExpiryDate,
        latestStatusKind: batch.latestStatusKind,
        nearExpiryDays,
      }),
    }));
  const earliestExpiry =
    batches.find((batch) => batch.effectiveExpiryDate !== null)
      ?.effectiveExpiryDate ?? null;
  const inventory: NonNullable<PurchaseItemDetails["inventory"]> = {
    balance: balance.toString(),
    breakdown: inventoryUnitBreakdown(balance, packaging),
    minimumLevel: fact.stockLevels.minimumLevel?.toString() ?? null,
    maximumLevel: fact.stockLevels.maximumLevel?.toString() ?? null,
    reconciliation: position?.reconciliation ?? "consistent",
    batches,
    alerts: riskIndicators({
      balance,
      businessDate,
      nearExpiryDays,
      earliestExpiry,
      coldStorageRequired: fact.coldStorageRequired,
      hasBarcode: fact.hasBarcode,
      minimumLevel: fact.stockLevels.minimumLevel,
      maximumLevel: fact.stockLevels.maximumLevel,
      reorderPoint: fact.stockLevels.reorderPoint,
      expiredCount: BigInt(
        batches.filter((b) => b.status === "expired").length,
      ),
      recalledCount: BigInt(
        batches.filter((b) => b.status === "recalled").length,
      ),
      quarantinedCount: BigInt(
        batches.filter((b) => b.status === "quarantined").length,
      ),
    }),
  };
  return {
    inventory,
    averageUnitCostFils:
      inventory.reconciliation === "consistent" ? averageFils(position) : null,
  };
}
