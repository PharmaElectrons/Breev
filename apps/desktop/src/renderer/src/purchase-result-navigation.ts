import type { PurchasePostedListResponse } from "@breev/contracts/local-rest";

/** Navigation is bounded to the loaded, filtered immutable Purchase results. */
export function purchaseResultNavigation(
  list: PurchasePostedListResponse | null,
  purchaseId: string,
) {
  const ids = [
    ...new Set(
      list?.purchases
        .filter((row) => row.rowKind === "purchase")
        .map((row) => row.id) ?? [],
    ),
  ];
  const index = ids.indexOf(purchaseId);
  return {
    previousId: index > 0 ? ids[index - 1]! : null,
    nextId: index >= 0 ? (ids[index + 1] ?? null) : null,
    position: index + 1,
    total: ids.length,
  };
}
