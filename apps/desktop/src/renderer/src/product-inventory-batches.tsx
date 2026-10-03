import { formatDateOnly, formatNumber } from "./preferences";
import { unitDisplayName } from "../../shared/unit-display";
import type { InventoryBatch } from "@breev/contracts/local-rest";
import { useState } from "react";
import { Boxes } from "lucide-react";

import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
import { InventoryApiDenied, listBatches } from "./inventory-api";
import { inventoryMessages } from "./inventory-messages";
import { catalogMessages } from "./catalog-messages";
import { useIdentityState } from "./identity-state-provider";
import { usePreferences } from "./preferences-provider";

type LoadState = "idle" | "loading" | "loaded" | "denied" | "error";

export function ProductInventoryBatches({
  baseUrl,
  productId,
  unitName,
}: {
  readonly baseUrl: string;
  readonly productId: string;
  readonly unitName: string;
}): React.JSX.Element | null {
  const { locale } = usePreferences();
  const { state: identityState } = useIdentityState();
  const copy = inventoryMessages[locale];
  const catalogCopy = catalogMessages[locale];
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [batches, setBatches] = useState<readonly InventoryBatch[]>([]);

  const canReviewInventory =
    identityState?.state === "authenticated" &&
    identityState.allowedPermissions.includes("inventory.review");
  if (!canReviewInventory) return null;

  const load = async (): Promise<void> => {
    setLoadState("loading");
    try {
      const response = await listBatches(baseUrl, productId);
      setBatches(response.batches);
      setLoadState("loaded");
    } catch (failure) {
      if (
        (failure instanceof IdentityApiDenied && failure.statusCode === 403) ||
        (failure instanceof LicensingApiDenied && failure.statusCode === 403) ||
        (failure instanceof InventoryApiDenied && failure.statusCode === 403)
      ) {
        setLoadState("denied");
      } else {
        setLoadState("error");
      }
    }
  };

  const formatDate = (value: string | null): string =>
    formatDateOnly(value, locale);
  const formatQuantity = (value: string): string => formatNumber(value, locale);

  return (
    <details
      className="catalog-secondary-panel catalog-batch-panel"
      onToggle={(event) => {
        if (event.currentTarget.open && loadState === "idle") void load();
      }}
    >
      <summary>
        <Boxes aria-hidden="true" size={16} strokeWidth={1.8} />
        <span>{catalogCopy.inventory.batchFactsTitle}</span>
      </summary>
      <div className="catalog-secondary-content">
        <p className="field-note">{catalogCopy.inventory.batchFactsReadOnly}</p>
        {loadState === "idle" || loadState === "loading" ? (
          <p role="status">{copy.loading}</p>
        ) : loadState === "denied" ? (
          <p role="alert">{copy.permissionDenied}</p>
        ) : loadState === "error" ? (
          <div role="alert" className="catalog-history-error">
            <p>{copy.reviewUnavailable}</p>
            <button
              className="quiet-button"
              type="button"
              onClick={() => void load()}
            >
              {copy.retry}
            </button>
          </div>
        ) : batches.length === 0 ? (
          <p role="status">{copy.safety.noBatches}</p>
        ) : (
          <div className="catalog-batch-table-scroll">
            <table>
              <caption className="visually-hidden">
                {catalogCopy.inventory.batchFactsTitle}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{copy.safety.reviewColumns.batch}</th>
                  <th scope="col">
                    {copy.safety.reviewColumns.effectiveExpiry}
                  </th>
                  <th scope="col">
                    {copy.safety.quantity} ({unitDisplayName(unitName, locale)})
                  </th>
                  <th scope="col">{copy.safety.status}</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.batchId}>
                    <td>
                      <bdi>{batch.lotNumber ?? "\u2014"}</bdi>
                    </td>
                    <td>
                      <bdi dir="ltr">
                        {formatDate(batch.effectiveExpiryDate)}
                      </bdi>
                    </td>
                    <td>
                      <bdi dir="ltr">{formatQuantity(batch.balance)}</bdi>
                    </td>
                    <td>{copy.safety.statusLabels[batch.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}
