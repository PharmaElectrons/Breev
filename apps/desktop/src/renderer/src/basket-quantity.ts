import type { ProductPackageUnit } from "@breev/contracts/local-rest";

export interface InventoryUnitDescription {
  readonly count: bigint;
  readonly unitName: string;
}

/**
 * Spells an exact inventory-unit quantity using the largest package units
 * first. This is display-only; the server remains authoritative for the
 * inventory-unit quantity.
 */
export function describeInventoryUnits(
  inventoryUnitName: string,
  packageUnits: readonly ProductPackageUnit[],
  quantity: bigint,
): readonly InventoryUnitDescription[] {
  if (quantity < 0n) {
    throw new RangeError("An inventory quantity to display cannot be negative");
  }

  const descending = [...packageUnits].sort((left, right) => {
    const leftRatio = BigInt(left.baseUnitsPerPackage);
    const rightRatio = BigInt(right.baseUnitsPerPackage);
    if (leftRatio === rightRatio) return 0;
    return leftRatio < rightRatio ? 1 : -1;
  });

  const described: InventoryUnitDescription[] = [];
  let remaining = quantity;
  for (const packageUnit of descending) {
    const ratio = BigInt(packageUnit.baseUnitsPerPackage);
    const count = remaining / ratio;
    if (count > 0n) {
      described.push({ count, unitName: packageUnit.name });
      remaining %= ratio;
    }
  }

  if (remaining > 0n || described.length === 0) {
    described.push({ count: remaining, unitName: inventoryUnitName });
  }
  return described;
}
