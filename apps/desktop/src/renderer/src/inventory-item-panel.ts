/**
 * Inventory facts for the shared purchase item panel.
 * Quantities stay integer strings. Package ratios are base units per package.
 */

export interface InventoryPanelSource {
  readonly balance: string;
  readonly consumptionRatePer30Days: string;
  readonly earliestExpiry: string | null;
  readonly maximumLevel: string | null;
  readonly minimumLevel: string | null;
}

export interface InventoryPackageUnit {
  readonly baseUnitsPerPackage: string;
  readonly name: string;
}

export interface InventoryPanelView {
  readonly consumption: string;
  readonly coverageDays: string | null;
  readonly expiryDate: string | null;
  readonly expiryDays: number | null;
  readonly intermediateCount: string | null;
  readonly intermediateLabel: string;
  readonly inventoryUnitName: string;
  readonly largeCount: string;
  readonly largeLabel: string;
  readonly largeRatio: bigint | null;
  readonly levelUnitName: string;
  readonly maximumLevel: string | null;
  readonly minimumLevel: string | null;
  readonly packagingLine: string | null;
  readonly remainder: string;
  readonly total: string;
}

export function buildInventoryPanelView(
  packaging: {
    readonly inventoryUnitName: string;
    readonly packageUnits: readonly InventoryPackageUnit[];
  },
  source: InventoryPanelSource,
  period: "month" | "quarter",
  formatCount: (value: bigint) => string,
  today: Date,
): InventoryPanelView {
  const balance = BigInt(source.balance);
  const rate = BigInt(source.consumptionRatePer30Days);
  const breakdown = decomposeInventoryUnits(balance, packaging.packageUnits);
  const coverage = inventoryCoverageDays(balance, rate);
  return {
    consumption: formatCount(period === "quarter" ? rate * 3n : rate),
    coverageDays: coverage === null ? null : formatCount(coverage),
    expiryDate: source.earliestExpiry,
    expiryDays:
      source.earliestExpiry === null
        ? null
        : calendarDaysUntil(source.earliestExpiry, today),
    intermediateCount:
      breakdown.intermediateCount === null
        ? null
        : formatCount(breakdown.intermediateCount),
    intermediateLabel: breakdown.intermediateLabel ?? "—",
    inventoryUnitName: packaging.inventoryUnitName,
    largeCount: formatCount(breakdown.largeCount),
    largeLabel: breakdown.largeLabel ?? "—",
    largeRatio: breakdown.largeRatio,
    levelUnitName: packaging.inventoryUnitName,
    maximumLevel:
      source.maximumLevel === null
        ? null
        : formatCount(BigInt(source.maximumLevel)),
    minimumLevel:
      source.minimumLevel === null
        ? null
        : formatCount(BigInt(source.minimumLevel)),
    packagingLine:
      breakdown.largeLabel === null || breakdown.largeRatio === null
        ? null
        : `1 ${breakdown.largeLabel} = ${formatCount(breakdown.largeRatio)} ${packaging.inventoryUnitName}`,
    remainder: formatCount(breakdown.remainder),
    total: formatCount(balance),
  };
}

export function decomposeInventoryUnits(
  balance: bigint,
  packageUnits: readonly InventoryPackageUnit[],
): {
  readonly intermediateCount: bigint | null;
  readonly intermediateLabel: string | null;
  readonly largeCount: bigint;
  readonly largeLabel: string | null;
  readonly largeRatio: bigint | null;
  readonly remainder: bigint;
} {
  const ranked = packageUnits
    .map((unit, index) => ({
      index,
      name: unit.name,
      ratio: BigInt(unit.baseUnitsPerPackage),
    }))
    .sort((left, right) =>
      left.ratio === right.ratio
        ? left.index - right.index
        : left.ratio > right.ratio
          ? -1
          : 1,
    );
  const large = ranked[0];
  const intermediate = ranked[1];
  if (balance < 0n || large === undefined) {
    return {
      intermediateCount: intermediate === undefined ? null : 0n,
      intermediateLabel: intermediate?.name ?? null,
      largeCount: 0n,
      largeLabel: large?.name ?? null,
      largeRatio: large?.ratio ?? null,
      remainder: balance,
    };
  }
  const largeCount = balance / large.ratio;
  const afterLarge = balance % large.ratio;
  if (intermediate === undefined) {
    return {
      intermediateCount: null,
      intermediateLabel: null,
      largeCount,
      largeLabel: large.name,
      largeRatio: large.ratio,
      remainder: afterLarge,
    };
  }
  return {
    intermediateCount: afterLarge / intermediate.ratio,
    intermediateLabel: intermediate.name,
    largeCount,
    largeLabel: large.name,
    largeRatio: large.ratio,
    remainder: afterLarge % intermediate.ratio,
  };
}

export function inventoryCoverageDays(
  balance: bigint,
  consumptionPer30Days: bigint,
): bigint | null {
  if (consumptionPer30Days <= 0n || balance < 0n) return null;
  return (balance * 30n) / consumptionPer30Days;
}

export function calendarDaysUntil(isoDate: string, today: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(isoDate);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const expiryUtc = Date.UTC(year, month - 1, day);
  const probe = new Date(expiryUtc);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return Math.round((expiryUtc - todayUtc) / 86_400_000);
}
