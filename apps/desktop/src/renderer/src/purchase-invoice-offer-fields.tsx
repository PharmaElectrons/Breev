import type { PurchaseInvoiceOfferInput } from "@breev/contracts/local-rest";
import { useEffect, useRef, useState } from "react";
import { purchasingMessages } from "./purchasing-messages";
import { usePreferences } from "./preferences-provider";
import {
  invoiceOfferIqdToFils,
  invoiceOfferFilsToIqd,
} from "./purchase-invoice-offer-money";

/** Prototype percentage/amount alternatives; the API owns all calculation. */
export function PurchaseInvoiceOfferFields({
  value,
  onChange,
  disabled,
}: {
  readonly value: PurchaseInvoiceOfferInput;
  readonly onChange: (value: PurchaseInvoiceOfferInput) => void;
  readonly disabled: boolean;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = purchasingMessages[locale];
  const [amountText, setAmountText] = useState(
    value.mode === "fixed" ? invoiceOfferFilsToIqd(value.value) : "0",
  );
  const emitted = useRef(JSON.stringify(value));
  useEffect(() => {
    const fingerprint = JSON.stringify(value);
    if (fingerprint !== emitted.current) {
      emitted.current = fingerprint;
      setAmountText(
        value.mode === "fixed" ? invoiceOfferFilsToIqd(value.value) : "0",
      );
    }
  }, [value]);
  function change(next: PurchaseInvoiceOfferInput): void {
    emitted.current = JSON.stringify(next);
    onChange(next);
  }
  return (
    <>
      <label>
        <span>{copy.invoiceOfferPercentage}</span>
        <input
          type="number"
          min="0"
          max="100"
          step="0.000001"
          dir="ltr"
          disabled={disabled}
          value={value.mode === "percentage" ? value.value : "0"}
          onChange={(event) => {
            setAmountText("0");
            change(
              event.target.value === "0"
                ? { mode: "none", value: "0" }
                : { mode: "percentage", value: event.target.value },
            );
          }}
        />
      </label>
      <label>
        <span>{copy.invoiceOfferAmount}</span>
        <input
          type="text"
          inputMode="decimal"
          dir="ltr"
          disabled={disabled}
          value={amountText}
          onChange={(event) => {
            setAmountText(event.target.value);
            const fils = invoiceOfferIqdToFils(event.target.value);
            change(
              fils === "0"
                ? { mode: "none", value: "0" }
                : { mode: "fixed", value: fils ?? "" },
            );
          }}
        />
      </label>
    </>
  );
}
