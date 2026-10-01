import {
  normalizeIndicDigits,
  type CountEntry,
  type InventoryCapableUnit,
  type ProductPackaging,
} from "@breev/contracts/local-rest";

export interface CountEntryUnit {
  readonly key: string;
  readonly label: string;
  readonly ratio: bigint;
  readonly unit: InventoryCapableUnit;
}

export interface CountEntryPreview {
  readonly countedQuantity: bigint;
  readonly entries: CountEntry[];
  readonly enteredLabel: string;
  readonly hasValue: boolean;
  readonly invalidField: string | null;
}

/** The count controls run from the largest exact package down to the base unit. */
export function countEntryUnits(
  packaging: ProductPackaging,
): readonly CountEntryUnit[] {
  const packages = packaging.packageUnits
    .map((packageUnit) => ({
      key: packageUnit.name,
      label: packageUnit.name,
      ratio: BigInt(packageUnit.baseUnitsPerPackage),
      unit: {
        kind: "package-unit" as const,
        packageUnitName: packageUnit.name,
      },
    }))
    .sort((left, right) => {
      if (left.ratio === right.ratio) return 0;
      return left.ratio > right.ratio ? -1 : 1;
    });

  return [
    ...packages,
    {
      key: packaging.inventoryUnitName,
      label: packaging.inventoryUnitName,
      ratio: 1n,
      unit: { kind: "inventory-unit" },
    },
  ];
}

/** Only the units the user actually typed are sent; an untouched control is
 * not an observation of zero, and a product may define more package units than
 * the wire accepts. */
export function countEntriesFromFields(
  packaging: ProductPackaging,
  fields: Readonly<Record<string, string>>,
): CountEntry[] {
  return countEntryUnits(packaging)
    .filter(({ key }) => (fields[key] ?? "").trim() !== "")
    .map(({ key, unit }) => ({
      count: normalizedCount(fields[key] ?? ""),
      unit,
    }));
}

export function countEntryCaption(
  packaging: ProductPackaging,
  fields: Readonly<Record<string, string>>,
): { readonly countedQuantity: bigint; readonly enteredLabel: string } {
  const units = countEntryUnits(packaging);
  const values = units.map(({ key, label, ratio }) => ({
    count: parseCount(fields[key] ?? ""),
    label,
    ratio,
  }));
  const countedQuantity = values.reduce(
    (total, value) => total + value.count * value.ratio,
    0n,
  );
  const visible = values.filter(({ count }) => count > 0n);
  const enteredLabel =
    visible.length === 0
      ? `0 ${packaging.inventoryUnitName}`
      : visible
          .map(({ count, label }) => `${count.toString()} ${label}`)
          .join(" + ");
  return { countedQuantity, enteredLabel };
}

export function countEntryLabelParts(
  label: string,
): readonly (string | bigint)[] {
  return normalizeIndicDigits(label)
    .split(/([0-9]+)/u)
    .filter((part) => part !== "")
    .map((part) => countFieldQuantity(part) ?? part);
}

export function buildCountEntryPreview(
  packaging: ProductPackaging,
  fields: Readonly<Record<string, string>>,
): CountEntryPreview {
  const invalidField = countEntryUnits(packaging).find(({ key }) => {
    const value = (fields[key] ?? "").trim();
    return value !== "" && countFieldQuantity(value) === null;
  })?.key;
  const entries = countEntriesFromFields(packaging, fields);
  const caption = countEntryCaption(packaging, fields);
  return {
    ...caption,
    entries,
    hasValue: countEntryUnits(packaging).some(
      ({ key }) => (fields[key] ?? "").trim() !== "",
    ),
    invalidField: invalidField ?? null,
  };
}

/** Whole quantity typed by a user, or null when the text is blank or not an integer.
 * Arabic-Indic and Persian digits are normalized before BigInt. */
export function countFieldQuantity(value: string): bigint | null {
  const normalized = normalizeIndicDigits(value).trim();
  return /^[0-9]+$/u.test(normalized) ? BigInt(normalized) : null;
}

function parseCount(value: string): bigint {
  return countFieldQuantity(value) ?? 0n;
}

export function normalizedCount(value: string): string {
  return countFieldQuantity(value)?.toString() ?? "0";
}
