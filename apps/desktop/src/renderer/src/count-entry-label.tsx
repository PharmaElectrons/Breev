import type { CountEntry } from "@breev/contracts/local-rest";
import { panelUnitLabel } from "./panel-unit-label";
import { formatNumber } from "./preferences";

export function CountEntryLabel({
  entries,
  inventoryUnitName,
  locale,
}: {
  readonly entries: readonly CountEntry[];
  readonly inventoryUnitName: string;
  readonly locale: "ar" | "en";
}): React.JSX.Element {
  return (
    <>
      {entries.map((entry, index) => {
        const count = BigInt(entry.count);
        const name =
          entry.unit.kind === "inventory-unit"
            ? inventoryUnitName
            : entry.unit.packageUnitName;
        return (
          <span key={index}>
            {index > 0 ? " + " : ""}
            <bdi>{formatNumber(count, locale)}</bdi>{" "}
            <bdi>{panelUnitLabel(name, count, locale)}</bdi>
          </span>
        );
      })}
    </>
  );
}

/** Before, after, and variance stay numeric in English and name the unit in Arabic. */
export function CountMeasure({
  count,
  locale,
  signed = false,
  unit,
}: {
  readonly count: bigint;
  readonly locale: "ar" | "en";
  readonly signed?: boolean;
  readonly unit: string;
}): React.JSX.Element {
  const text =
    signed && count > 0n
      ? `+${formatNumber(count, locale)}`
      : formatNumber(count, locale);
  return (
    <>
      <bdi>{text}</bdi>
      {locale === "ar" ? ` ${panelUnitLabel(unit, count, locale)}` : null}
    </>
  );
}
