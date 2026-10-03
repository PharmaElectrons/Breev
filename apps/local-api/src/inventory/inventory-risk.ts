import type {
  InventoryRiskIndicator,
  ProductDisplayColour,
  ProductManualStateColour,
  ProductStateColour,
} from "@breev/contracts/local-rest";

import { addDays, compareDates } from "./business-date.js";
import { divideFilsRounded } from "../posting/money.js";

export interface InventoryRiskMovement {
  readonly occurredAt: Date;
  readonly quantity: bigint;
  readonly reason?:
    | "purchase-adjustment"
    | "purchase-receipt"
    | "purchase-return"
    | "count-variance";
}

export interface InventoryRiskInput {
  readonly balance: bigint;
  readonly earliestExpiry: string | null;
  readonly expiredCount: bigint;
  readonly hasBarcode: boolean;
  readonly quarantinedCount: bigint;
  readonly recalledCount: bigint;
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
  return consumptionOverWindow(
    movements.map((m) => ({ ...m, eligibleDemand: m.reason === undefined })),
    now,
    90,
    true,
  ).per30Days;
}

/** Only the owner identifies eligible posted demand. Reports use [To-window, To). */
export function consumptionOverWindow(
  movements: readonly {
    readonly occurredAt: Date;
    readonly quantity: bigint;
    readonly eligibleDemand: boolean;
  }[],
  to: Date,
  days: 30 | 60 | 90,
  includeCutoff = false,
): { readonly consumed: bigint; readonly per30Days: bigint } {
  const start = to.getTime() - days * 86_400_000;
  const consumed = movements.reduce(
    (sum, m) =>
      m.eligibleDemand &&
      m.quantity < 0n &&
      m.occurredAt.getTime() >= start &&
      (includeCutoff ? m.occurredAt <= to : m.occurredAt < to)
        ? sum - m.quantity
        : sum,
    0n,
  );
  return {
    consumed,
    per30Days: divideFilsRounded(consumed * 30n, BigInt(days)),
  };
}

export function riskIndicators(
  input: InventoryRiskInput,
): InventoryRiskIndicator[] {
  const indicators: InventoryRiskIndicator[] = [];
  if (input.recalledCount > 0n) indicators.push("recalled");
  if (input.quarantinedCount > 0n) indicators.push("quarantined");
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
  if (
    indicators.includes("recalled") ||
    indicators.includes("quarantined") ||
    indicators.includes("expired") ||
    indicators.includes("out-of-stock")
  ) {
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
  manual: ProductManualStateColour | null,
  automatic: ProductStateColour,
): ProductDisplayColour {
  return manual ?? automatic;
}
