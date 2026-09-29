import type { Locale } from "./preferences";

/**
 * One currency amount. English stays left-to-right on a single line so the
 * IQD prefix cannot wrap or sit on the other side of the number.
 */
export function MoneyAmount({
  locale,
  value,
}: {
  readonly locale: Locale;
  readonly value: string;
}): React.JSX.Element {
  return (
    <bdi className="money-amount" dir={locale === "en" ? "ltr" : undefined}>
      {value}
    </bdi>
  );
}
