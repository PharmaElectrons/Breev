import type { SaleDraftLine } from "@breev/contracts/local-rest";
import { useEffect, useState } from "react";

import type { Locale } from "./preferences";

export type SalesCalculatorTarget =
  "quantity" | "price" | "line-discount" | "invoice-discount";

export function SalesCalculator({
  busy,
  allowPrice,
  line,
  locale,
  onApply,
}: {
  readonly busy: boolean;
  readonly allowPrice: boolean;
  readonly line: SaleDraftLine | null;
  readonly locale: Locale;
  readonly onApply: (target: SalesCalculatorTarget, value: string) => void;
}): React.JSX.Element {
  const [target, setTarget] = useState<SalesCalculatorTarget>("quantity");
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    setTarget(line === null ? "invoice-discount" : "quantity");
    setValue("");
  }, [line?.id]);
  const copy =
    locale === "ar"
      ? {
          heading: "الحاسبة",
          quantity: "تغيير العدد",
          price: "تغيير السعر",
          lineDiscount: "خصم السطر %",
          invoiceDiscount: "خصم الفاتورة",
          apply: "تطبيق على المسودة",
          clear: "مسح",
          backspace: "حذف آخر رقم",
          invalid: "أدخل قيمة صالحة لهذا الهدف.",
        }
      : {
          heading: "Calculator",
          quantity: "Change quantity",
          price: "Change price",
          lineDiscount: "Line discount %",
          invoiceDiscount: "Invoice discount",
          apply: "Apply to draft",
          clear: "Clear",
          backspace: "Delete last digit",
          invalid: "Enter a valid value for this target.",
        };

  function append(key: string): void {
    setError(false);
    setValue((current) => {
      if (
        key === "." &&
        ((target !== "invoice-discount" && target !== "price") ||
          current.includes("."))
      )
        return current;
      return `${current}${key}`.slice(0, 24);
    });
  }

  function submit(): void {
    const normalized = value.trim();
    if (target === "quantity") {
      if (!/^[1-9][0-9]*$/u.test(normalized)) {
        setError(true);
        return;
      }
      onApply(target, BigInt(normalized).toString());
      return;
    }
    if (target === "line-discount") {
      if (!/^(100|[1-9]?[0-9])$/u.test(normalized)) {
        setError(true);
        return;
      }
      onApply(target, String(Number(normalized)));
      return;
    }
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/u.test(normalized)) {
      setError(true);
      return;
    }
    const [whole = "0", fraction = ""] = normalized.split(".");
    onApply(
      target,
      (BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0"))).toString(),
    );
  }

  return (
    <section aria-label={copy.heading} className="sales-calculator">
      <h3>{copy.heading}</h3>
      <div className="sales-calculator-targets">
        <button
          aria-pressed={target === "quantity"}
          disabled={busy || line === null}
          type="button"
          onClick={() => {
            setTarget("quantity");
            setValue("");
          }}
        >
          {copy.quantity}
        </button>
        {allowPrice ? (
          <button
            aria-pressed={target === "price"}
            disabled={busy || line?.kind !== "catalog"}
            type="button"
            onClick={() => {
              setTarget("price");
              setValue("");
            }}
          >
            {copy.price}
          </button>
        ) : null}
        <button
          aria-pressed={target === "line-discount"}
          disabled={busy || line === null}
          type="button"
          onClick={() => {
            setTarget("line-discount");
            setValue("");
          }}
        >
          {copy.lineDiscount}
        </button>
        <button
          aria-pressed={target === "invoice-discount"}
          disabled={busy}
          type="button"
          onClick={() => {
            setTarget("invoice-discount");
            setValue("");
          }}
        >
          {copy.invoiceDiscount}
        </button>
      </div>
      <input
        aria-label={copy.heading}
        disabled={busy}
        inputMode={
          target === "invoice-discount" || target === "price"
            ? "decimal"
            : "numeric"
        }
        type="text"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError(false);
        }}
      />
      <div className="sales-calculator-keys">
        {["7", "8", "9", "4", "5", "6", "1", "2", "3", "C", "0", ".", "⌫"].map(
          (key) => (
            <button
              aria-label={
                key === "C" ? copy.clear : key === "⌫" ? copy.backspace : key
              }
              disabled={
                busy ||
                (key === "." &&
                  target !== "invoice-discount" &&
                  target !== "price")
              }
              key={key}
              type="button"
              onClick={() => {
                if (key === "C") {
                  setValue("");
                  setError(false);
                } else if (key === "⌫") {
                  setValue((current) => current.slice(0, -1));
                  setError(false);
                } else append(key);
              }}
            >
              {key}
            </button>
          ),
        )}
      </div>
      {error ? <p role="alert">{copy.invalid}</p> : null}
      <button
        className="sales-calculator-apply"
        disabled={
          busy ||
          value.trim() === "" ||
          (line === null && target !== "invoice-discount")
        }
        type="button"
        onClick={submit}
      >
        {copy.apply}
      </button>
    </section>
  );
}
