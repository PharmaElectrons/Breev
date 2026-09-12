import type {
  CountEntry,
  InventoryCapableUnit,
  ProductPackaging,
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
  return label
    .split(/(\d+)/u)
    .filter((part) => part !== "")
    .map((part) => (/^\d+$/u.test(part) ? BigInt(part) : part));
}

export function buildCountEntryPreview(
  packaging: ProductPackaging,
  fields: Readonly<Record<string, string>>,
): CountEntryPreview {
  const invalidField = countEntryUnits(packaging).find(({ key }) => {
    const value = fields[key] ?? "";
    return value.trim() !== "" && !/^\d+$/u.test(value.trim());
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

function parseCount(value: string): bigint {
  const normalized = value.trim();
  return normalized === "" || !/^\d+$/u.test(normalized)
    ? 0n
    : BigInt(normalized);
}

function normalizedCount(value: string): string {
  const normalized = value.trim();
  if (normalized === "" || !/^\d+$/u.test(normalized)) return "0";
  return normalized.replace(/^0+(?=\d)/u, "");
}
