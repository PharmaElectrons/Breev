import type { PurchaseDraft } from "@breev/contracts/local-rest";
import type { Locale } from "./preferences";

export interface PurchaseDraftFilterOptions {
  readonly context: "all" | "cash" | "debt";
  readonly date: string;
  readonly isDateInvalid: boolean;
  readonly locale: Locale;
  readonly query: string;
}

/**
 * Filter purchase drafts by search text, invoice date, and settlement context.
 *
 * Invariant: If `isDateInvalid` is true (e.g. from an impossible calendar date
 * such as Day 31 on a 30-day month like September or April, or bad input), the
 * filter must match ZERO drafts and must NEVER fall back to a wildcard match.
 */
export function filterPurchaseDrafts(
  drafts: readonly PurchaseDraft[],
  options: PurchaseDraftFilterOptions,
): readonly PurchaseDraft[] {
  const normalizedQuery = options.query
    .trim()
    .toLocaleLowerCase(options.locale);

  return drafts.filter((draft) => {
    const matchesQuery =
      normalizedQuery === "" ||
      draft.supplierInvoiceNumber
        .toLocaleLowerCase(options.locale)
        .includes(normalizedQuery) ||
      draft.supplierNameSnapshot
        .toLocaleLowerCase(options.locale)
        .includes(normalizedQuery);

    const matchesDate = options.isDateInvalid
      ? false
      : options.date === "" || draft.invoiceDate === options.date;

    const matchesContext =
      options.context === "all" || draft.settlementContext === options.context;

    return matchesQuery && matchesDate && matchesContext;
  });
}
