import type { SaleDraftLine } from "@breev/contracts/local-rest";
import { useEffect, useRef, useState } from "react";

import { formatCurrencyFromFils } from "./preferences";
import type { Locale } from "./preferences";

function asIqd(fils: string): string {
  const amount = BigInt(fils);
  const fraction = amount % 1_000n;
  return fraction === 0n
    ? String(amount / 1_000n)
    : `${amount / 1_000n}.${String(fraction).padStart(3, "0").replace(/0+$/u, "")}`;
}

function toFils(value: string): string | null {
  const normalized = value.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/u.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const fils = BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0"));
  return fils <= 9_223_372_036_854_775_807n ? fils.toString() : null;
}

export function SalePriceDialog({
  line,
  initialPriceFils,
  locale,
  busy,
  pending,
  error,
  onCancel,
  onSave,
  onRetry,
}: {
  readonly line: SaleDraftLine;
  readonly initialPriceFils: string;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onSave: (unitPriceFils: string, reason: string) => void;
  readonly onRetry: () => void;
}): React.JSX.Element {
  const [priceIqd, setPriceIqd] = useState(() => asIqd(initialPriceFils));
  const [reason, setReason] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.focus();
  }, []);
  const ar = locale === "ar";

  return (
    <div className="sales-create-backdrop">
      <div
        aria-label={ar ? "تغيير سعر السطر" : "Change line price"}
        aria-modal="true"
        className="sales-create-dialog sales-price-dialog"
        ref={dialog}
        role="dialog"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy && !pending) onCancel();
        }}
      >
        <h3>{ar ? "تغيير سعر السطر" : "Change line price"}</h3>
        <strong>
          {line.displayName} · {line.unitName}
        </strong>
        <p>
          {ar ? "السعر المحفوظ" : "Saved price"}:{" "}
          {formatCurrencyFromFils(BigInt(line.unitPriceFils), locale)}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const unitPriceFils = toFils(priceIqd);
            if (
              unitPriceFils === null ||
              reason.trim().length === 0 ||
              reason.trim().length > 250
            ) {
              setValidation(
                ar
                  ? "أدخل سعراً وسبباً صالحين."
                  : "Enter a valid price and reason.",
              );
              return;
            }
            setValidation(null);
            onSave(unitPriceFils, reason.trim());
          }}
        >
          <label>
            {ar ? "سعر الوحدة (د.ع)" : "Unit price (IQD)"}
            <input
              disabled={busy || pending}
              inputMode="decimal"
              required
              value={priceIqd}
              onChange={(event) => setPriceIqd(event.target.value)}
            />
          </label>
          <label>
            {ar ? "سبب التغيير" : "Reason"}
            <textarea
              disabled={busy || pending}
              maxLength={250}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {validation === null ? null : <p role="alert">{validation}</p>}
          {error === null ? null : <p role="alert">{error}</p>}
          <div className="sales-price-dialog-actions">
            <button disabled={busy || pending} type="submit">
              {ar ? "حفظ السعر" : "Save price"}
            </button>
            {pending ? (
              <button disabled={busy} type="button" onClick={onRetry}>
                {ar ? "إعادة المحاولة" : "Retry save"}
              </button>
            ) : null}
            <button disabled={busy || pending} type="button" onClick={onCancel}>
              {ar ? "إلغاء" : "Cancel"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
