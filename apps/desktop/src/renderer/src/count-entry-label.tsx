import { countEntryLabelParts } from "./count-entry";
import { localizeUnitPhrase, panelUnitLabel } from "./panel-unit-label";
import { formatNumber } from "./preferences";

export function CountEntryLabel({
  label,
  locale,
}: {
  readonly label: string;
  readonly locale: "ar" | "en";
}): React.JSX.Element {
  let count = 1n;
  return (
    <>
      {countEntryLabelParts(label).map((part, index) => {
        if (typeof part === "bigint") {
          count = part;
          return (
            <bdi key={`${part.toString()}-${index}`}>
              {formatNumber(part, locale)}
            </bdi>
          );
        }
        return (
          <span key={`${part}-${index}`}>
            {localizeUnitPhrase(part, count, locale)}
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
