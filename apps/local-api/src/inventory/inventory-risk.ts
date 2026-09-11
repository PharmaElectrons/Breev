import type {
  InventoryRiskIndicator,
  ProductStateColour,
} from "@breev/contracts/local-rest";

import { addDays, compareDates } from "./business-date.js";
import { divideFilsRounded } from "../posting/money.js";

export interface InventoryRiskMovement {
  readonly occurredAt: Date;
  readonly quantity: bigint;
  readonly reason?:
    "purchase-adjustment" | "purchase-receipt" | "purchase-return";
}

export interface InventoryRiskInput {
  readonly balance: bigint;
  readonly earliestExpiry: string | null;
  readonly expiredCount: bigint;
  readonly hasBarcode: boolean;
  readonly maximumLevel: bigint | null;
  readonly minimumLevel: bigint | null;
  readonly businessDate: string;
  readonly nearExpiryDays: number;
  readonly reorderPoint: bigint | null;
  readonly coldStorageRequired: boolean;
}

export function consumptionRatePer30Days(
  movements: readonly InventoryRiskMovement[],
  now: Date,
): bigint {
  const windowStart = now.getTime() - 90 * 24 * 60 * 60 * 1_000;
  const consumed = movements.reduce((total, movement) => {
    if (
      movement.occurredAt.getTime() < windowStart ||
      movement.occurredAt.getTime() > now.getTime() ||
      movement.quantity >= 0n ||
      movement.reason === "purchase-adjustment" ||
      movement.reason === "purchase-return"
    ) {
      return total;
    }
    return total - movement.quantity;
  }, 0n);
  return divideFilsRounded(consumed * 30n, 90n);
}

export function riskIndicators(
  input: InventoryRiskInput,
): InventoryRiskIndicator[] {
  const indicators: InventoryRiskIndicator[] = [];
  if (input.balance === 0n) indicators.push("out-of-stock");
  if (input.minimumLevel !== null && input.balance < input.minimumLevel) {
    indicators.push("below-minimum");
  }
  if (input.reorderPoint !== null && input.balance <= input.reorderPoint) {
    indicators.push("at-or-below-reorder-point");
  }
  if (input.maximumLevel !== null && input.balance > input.maximumLevel) {
    indicators.push("above-maximum");
  }
  if (input.expiredCount > 0n) indicators.push("expired");
  if (
    input.earliestExpiry !== null &&
    compareDates(input.earliestExpiry, input.businessDate) >= 0 &&
    compareDates(
      input.earliestExpiry,
      addDays(input.businessDate, input.nearExpiryDays),
    ) <= 0
  ) {
    indicators.push("expiring-soon");
  }
  if (!input.hasBarcode) indicators.push("missing-barcode");
  if (input.coldStorageRequired) indicators.push("cold-storage");
  return indicators;
}

export function automaticStateColour(
  indicators: readonly InventoryRiskIndicator[],
): ProductStateColour {
  if (indicators.includes("expired") || indicators.includes("out-of-stock")) {
    return "red";
  }
  if (
    indicators.includes("below-minimum") ||
    indicators.includes("at-or-below-reorder-point")
  ) {
    return "orange";
  }
  if (indicators.includes("expiring-soon")) return "yellow";
  if (indicators.includes("cold-storage")) return "blue";
  if (indicators.includes("missing-barcode")) return "grey";
  if (indicators.includes("above-maximum")) return "purple";
  return "green";
}

export function effectiveStateColour(
  manual: ProductStateColour | null,
  automatic: ProductStateColour,
): ProductStateColour {
  return manual ?? automatic;
}
