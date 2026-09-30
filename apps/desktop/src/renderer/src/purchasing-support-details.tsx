import { useState } from "react";
import { usePreferences } from "./preferences-provider";
import { purchasingSupportMessages } from "./purchasing-messages";

/** Correlation remains available for support without entering ordinary errors. */
export function PurchasingSupportDetails({
  reference,
}: {
  readonly reference: string;
}) {
  const { locale } = usePreferences();
  const [status, setStatus] = useState("");
  const copy = purchasingSupportMessages[locale];
  return (
    <details key={reference} className="purchasing-support-details">
      <summary>{copy.title}</summary>
      <bdi>
        <code>{reference}</code>
      </bdi>
      <button
        type="button"
        className="quiet-button"
        onClick={() => {
          if (navigator.clipboard === undefined) {
            setStatus(copy.failed);
            return;
          }
          void navigator.clipboard
            .writeText(reference)
            .then(() => setStatus(copy.copied))
            .catch(() => setStatus(copy.failed));
        }}
      >
        {copy.copy}
      </button>
      <span role="status">{status}</span>
    </details>
  );
}
