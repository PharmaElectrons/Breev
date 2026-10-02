import type { InventoryMovement } from "@breev/contracts/local-rest";
import { useState } from "react";
import { History } from "lucide-react";

import { IdentityApiDenied, LicensingApiDenied } from "./identity-api";
import { InventoryApiDenied, requestInventoryMovements } from "./inventory-api";
import { inventoryMessages } from "./inventory-messages";
import { useIdentityState } from "./identity-state-provider";
import { usePreferences } from "./preferences-provider";
import { catalogMessages } from "./catalog-messages";

const DISPLAY_LIMIT = 8;

export function ProductMovementHistory({
  baseUrl,
  productId,
}: {
  readonly baseUrl: string;
  readonly productId: string;
}): React.JSX.Element | null {
  const { locale } = usePreferences();
  const { state: identityState } = useIdentityState();
  const copy = inventoryMessages[locale];
  const historyCopy = catalogMessages[locale].movementHistory;
  const [status, setStatus] = useState<
    "idle" | "loading" | "loaded" | "denied" | "error"
  >("idle");
  const [movements, setMovements] = useState<readonly InventoryMovement[]>([]);

  const canReview =
    identityState?.state === "authenticated" &&
    identityState.allowedPermissions.includes("inventory.review");
  if (!canReview) return null;

  const load = async (): Promise<void> => {
    setStatus("loading");
    try {
      const response = await requestInventoryMovements(baseUrl, productId);
      setMovements(response.movements.slice(0, DISPLAY_LIMIT));
      setStatus("loaded");
    } catch (failure) {
      if (
        (failure instanceof IdentityApiDenied && failure.statusCode === 403) ||
        (failure instanceof LicensingApiDenied && failure.statusCode === 403) ||
        (failure instanceof InventoryApiDenied && failure.statusCode === 403)
      ) {
        setStatus("denied");
      } else {
        setStatus("error");
      }
    }
  };

  const formatDate = (value: string): string => {
    const date = new Date(value);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  };
  const formatTime = (value: string): string =>
    new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      numberingSystem: "latn",
      second: "2-digit",
    }).format(new Date(value));
  const formatQuantity = (value: string): string => {
    const quantity = BigInt(value);
    const amount = new Intl.NumberFormat(locale, {
      numberingSystem: "latn",
    }).format(quantity < 0n ? -quantity : quantity);
    if (quantity === 0n) return amount;
    const sign = quantity < 0n ? "-" : "+";
    return locale === "ar" ? `${amount}${sign}` : `${sign}${amount}`;
  };
  const formatValue = (value: string): string => {
    const fils = BigInt(value);
    const absoluteFils = fils < 0n ? -fils : fils;
    const whole = absoluteFils / 1000n;
    const fraction = absoluteFils % 1000n;
    const formattedWhole = new Intl.NumberFormat(locale, {
      numberingSystem: "latn",
    }).format(whole);
    const decimal =
      fraction === 0n
        ? ""
        : `.${fraction.toString().padStart(3, "0").replace(/0+$/u, "")}`;
    const sign = fils < 0n ? "-" : "";
    const unit = locale === "ar" ? "د.ع" : "IQD";
    return `${sign}${formattedWhole}${decimal} ${unit}`;
  };
  const kindLabel = (kind: InventoryMovement["kind"]): string => {
    switch (kind) {
      case "purchase-adjustment":
        return copy.movement.adjustment;
      case "purchase-receipt":
        return copy.movement.receipt;
      case "purchase-return":
        return copy.movement.return;
      case "count-variance":
        return copy.movement.countVariance;
    }
  };

  const hasValuation = movements.some(
    (movement) => movement.valueFils !== null,
  );

  return (
    <details
      className="catalog-secondary-panel catalog-movement-panel"
      onToggle={(event) => {
        if (event.currentTarget.open && status === "idle") void load();
      }}
    >
      <summary>
        <History aria-hidden="true" size={16} strokeWidth={1.8} />
        <span>{copy.movement.title}</span>
      </summary>
      <div className="catalog-secondary-content">
        {status === "idle" || status === "loading" ? (
          <p role="status">{copy.loading}</p>
        ) : status === "denied" ? (
          <p role="alert">{copy.permissionDenied}</p>
        ) : status === "error" ? (
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
        ) : movements.length === 0 ? (
          <p role="status">{copy.movement.empty}</p>
        ) : (
          <>
            <p className="field-note">{historyCopy.recent}</p>
            <div className="catalog-movement-table-scroll">
              <table>
                <caption className="visually-hidden">
                  {copy.movement.title}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{copy.movement.date}</th>
                    <th scope="col">{copy.movement.time}</th>
                    <th scope="col">{copy.movement.kind}</th>
                    <th scope="col">{copy.movement.reference}</th>
                    <th scope="col">{copy.movement.user}</th>
                    <th scope="col">{copy.movement.quantity}</th>
                    {hasValuation ? (
                      <th scope="col">{copy.movement.value}</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {movements.map((movement) => {
                    const quantity = BigInt(movement.quantity);
                    const sign =
                      quantity < 0n
                        ? "negative"
                        : quantity > 0n
                          ? "positive"
                          : "neutral";
                    const referenceHref =
                      movement.reference.documentType === "count-session"
                        ? `#/inventory/items/${productId}/movements/count-sessions/${movement.reference.documentId}`
                        : `#/inventory/items/${productId}/movements/${movement.reference.documentId}`;
                    return (
                      <tr key={movement.id}>
                        <td>
                          <bdi dir="ltr">{formatDate(movement.occurredAt)}</bdi>
                        </td>
                        <td>
                          <bdi dir={locale === "ar" ? "rtl" : "ltr"}>
                            {formatTime(movement.occurredAt)}
                          </bdi>
                        </td>
                        <td>{kindLabel(movement.kind)}</td>
                        <td data-sign={sign}>
                          {movement.reference.openable ? (
                            <a
                              className="catalog-movement-reference"
                              href={referenceHref}
                            >
                              {movement.reference.label}
                            </a>
                          ) : (
                            <span>{movement.reference.label}</span>
                          )}
                        </td>
                        <td>{movement.user.displayName}</td>
                        <td data-sign={sign}>
                          <bdi dir="ltr">
                            {formatQuantity(movement.quantity)}
                          </bdi>
                        </td>
                        {hasValuation ? (
                          <td>
                            <bdi>
                              {movement.valueFils === null
                                ? "—"
                                : formatValue(movement.valueFils)}
                            </bdi>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <a
          className="catalog-history-link"
          href={`#/inventory/items/${productId}/movements`}
        >
          {historyCopy.openFull}
        </a>
      </div>
    </details>
  );
}
