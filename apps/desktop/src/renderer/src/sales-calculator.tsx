import { normalizeNumericInput } from "./numeric-input";
import { unitDisplayName } from "../../shared/unit-display";
import type { SaleDraftLine } from "@breev/contracts/local-rest";
import { useEffect, useState } from "react";

import {
  formatCurrencyFromFils,
  formatNumber,
  type Locale,
} from "./preferences";

export type SalesCalculatorTarget =
  "quantity" | "price" | "line-discount" | "invoice-discount";

export interface SalesCalculatorProps {
  readonly busy: boolean;
  readonly allowPrice: boolean;
  readonly line: SaleDraftLine | null;
  readonly locale: Locale;
  readonly invoiceDiscountFils?: string | undefined;
  readonly onApply: (target: SalesCalculatorTarget, value: string) => void;
  readonly onOpenMiscAdd?: (() => void) | undefined;
  readonly onChangeUnit?: (() => void) | undefined;
}

export function stepCalculatorQuantity(
  value: string,
  direction: 1 | -1,
): string {
  const normalized = normalizeNumericInput(value.trim(), true);
  const current =
    normalized.length === 0
      ? direction === 1
        ? 0n
        : 1n
      : /^\d+$/u.test(normalized)
        ? BigInt(normalized)
        : null;
  if (current === null) return value;
  const next =
    direction === 1 ? current + 1n : current > 1n ? current - 1n : 1n;
  return next.toString();
}

export function SalesCalculator({
  busy,
  allowPrice,
  line,
  locale,
  invoiceDiscountFils = "0",
  onApply,
  onOpenMiscAdd,
  onChangeUnit,
}: SalesCalculatorProps): React.JSX.Element {
  const [target, setTarget] = useState<SalesCalculatorTarget>("quantity");
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [quickDiscount, setQuickDiscount] = useState("");

  useEffect(() => {
    setTarget(line === null ? "invoice-discount" : "quantity");
    setValue("");
    setError(false);
  }, [line?.id]);

  const copy =
    locale === "ar"
      ? {
          heading: "الحاسبة",
          quantity: "تغيير العدد",
          price: "تغيير السعر",
          unit: "تغيير الوحدة",
          lineDiscount: "خصم السطر %",
          invoiceDiscount: "خصم الفاتورة",
          apply: "تطبيق على المسودة",
          clear: "مسح",
          backspace: "حذف آخر رقم",
          invalid: "أدخل قيمة صالحة لهذا الهدف.",
          collapse: "طي الحاسبة",
          expand: "فتح الحاسبة",
          previewTitle: "معاينة المادة المحددة",
          noItemSelected: "اختر مادة",
          discountAmount: "مبلغ الخصم",
          addProduct: "+ منتج",
          amount: "المبلغ",
        }
      : {
          heading: "Calculator",
          quantity: "Change quantity",
          price: "Change price",
          unit: "Change unit",
          lineDiscount: "Line discount %",
          invoiceDiscount: "Invoice discount",
          apply: "Apply to draft",
          clear: "Clear",
          backspace: "Delete last digit",
          invalid: "Enter a valid value for this target.",
          collapse: "Collapse calculator",
          expand: "Open calculator",
          previewTitle: "Selected item preview",
          noItemSelected: "Choose an item",
          discountAmount: "Discount amount",
          addProduct: "+ Product",
          amount: "Amount",
        };

  function append(key: string): void {
    setError(false);
    setValue((current) => {
      if (
        key === "." &&
        ((target !== "invoice-discount" && target !== "price") ||
          current.includes("."))
      ) {
        return current;
      }
      return `${current}${key}`.slice(0, 24);
    });
  }

  function submit(): void {
    const normalized = normalizeNumericInput(value.trim(), true);
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
      onApply(target, BigInt(normalized).toString());
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

  const targetLabel =
    target === "quantity"
      ? copy.quantity
      : target === "price"
        ? copy.price
        : target === "line-discount"
          ? copy.lineDiscount
          : copy.invoiceDiscount;

  return (
    <section
      aria-label={copy.heading}
      className="sales-calculator"
      data-collapsed={isCollapsed ? "true" : undefined}
    >
      <div className="sales-calculator-header">
        <div className="sales-calculator-header-title">
          <span className="sales-calc-icon" aria-hidden="true">
            🔢
          </span>
          <h3>{copy.heading}</h3>
        </div>
        <button
          type="button"
          className="sales-collapse-toggle-btn sales-calc-collapse-btn"
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? copy.expand : copy.collapse}
          title={isCollapsed ? copy.expand : copy.collapse}
          onClick={() => setIsCollapsed((prev) => !prev)}
        >
          <span className="sales-collapse-icon" aria-hidden="true">
            {isCollapsed ? "▲" : "▼"}
          </span>
          <span>{isCollapsed ? copy.expand : copy.collapse}</span>
        </button>
      </div>

      <div className="sales-calculator-display-card">
        <div className="sales-calculator-screen-top">
          <span className="sales-calc-target-tag">{targetLabel}</span>
          {onOpenMiscAdd ? (
            <button
              type="button"
              className="sales-calc-add-product-btn"
              onClick={onOpenMiscAdd}
            >
              {copy.addProduct}
            </button>
          ) : null}
        </div>
        <input
          aria-label={copy.heading}
          className="sales-calculator-screen-input"
          disabled={busy}
          inputMode={
            target === "invoice-discount" || target === "price"
              ? "decimal"
              : "numeric"
          }
          placeholder="0"
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>

      <div className="sales-calculator-keys">
        {[
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
          "9",
          "C",
          "0",
          ".",
          "-",
          "000",
          "+",
        ].map((key) => {
          const isDotDisabled =
            key === "." && target !== "invoice-discount" && target !== "price";
          return (
            <button
              aria-label={
                key === "C"
                  ? copy.clear
                  : key === "-"
                    ? "minus"
                    : key === "+"
                      ? "plus"
                      : key
              }
              className={`sales-calc-key ${key === "C" ? "sales-key-clear" : ""} ${key === "+" || key === "-" ? "sales-key-op" : ""}`}
              disabled={busy || isDotDisabled}
              key={key}
              type="button"
              onClick={() => {
                if (key === "C") {
                  setValue("");
                  setError(false);
                } else if (key === "+") {
                  if (target === "quantity") {
                    setValue(stepCalculatorQuantity(value, 1));
                  } else {
                    append("+");
                  }
                } else if (key === "-") {
                  if (target === "quantity") {
                    setValue(stepCalculatorQuantity(value, -1));
                  } else {
                    append("-");
                  }
                } else {
                  append(key);
                }
              }}
            >
              {key}
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="sales-calculator-error" role="alert">
          {copy.invalid}
        </p>
      ) : null}

      <div className="sales-calculator-actions-group">
        <div className="sales-calculator-targets">
          {allowPrice ? (
            <button
              aria-pressed={target === "price"}
              className={`sales-target-pill ${target === "price" ? "active" : ""}`}
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
            aria-pressed={target === "quantity"}
            className={`sales-target-pill ${target === "quantity" ? "active" : ""}`}
            disabled={busy || line === null}
            type="button"
            onClick={() => {
              setTarget("quantity");
              setValue("");
            }}
          >
            {copy.quantity}
          </button>

          {onChangeUnit ? (
            <button
              className="sales-target-pill"
              disabled={busy || line === null}
              type="button"
              onClick={onChangeUnit}
            >
              {copy.unit}
            </button>
          ) : null}

          <button
            aria-pressed={target === "line-discount"}
            className={`sales-target-pill ${target === "line-discount" ? "active" : ""}`}
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
            className={`sales-target-pill ${target === "invoice-discount" ? "active" : ""}`}
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

        <button
          className="sales-calculator-apply"
          disabled={busy || value.trim().length === 0}
          type="button"
          onClick={submit}
        >
          {copy.apply}
        </button>
      </div>

      <div className="sales-calculator-preview-section">
        <span className="sales-calc-section-label">{copy.previewTitle}</span>
        {line === null ? (
          <div className="sales-calc-preview-empty">
            <span>{copy.noItemSelected}</span>
          </div>
        ) : (
          <div className="sales-calc-preview-card">
            <strong className="sales-calc-preview-name">
              {line.displayName}
            </strong>
            <div className="sales-calc-preview-row">
              <span>
                {unitDisplayName(line.unitName, locale)} ×{" "}
                {formatNumber(BigInt(line.quantity), locale)}
              </span>
              <strong>
                {formatCurrencyFromFils(BigInt(line.totalFils), locale)}
              </strong>
            </div>
          </div>
        )}
      </div>

      <div className="sales-calculator-discount-row">
        <label
          htmlFor="sales-calculator-discount-input"
          className="sales-calc-discount-label"
        >
          {copy.discountAmount}
        </label>
        <div className="sales-calc-discount-input-wrap">
          <input
            id="sales-calculator-discount-input"
            className="sales-calc-discount-input"
            disabled={busy}
            inputMode="decimal"
            placeholder={
              BigInt(invoiceDiscountFils) > 0n
                ? (BigInt(invoiceDiscountFils) / 1000n).toString()
                : "0"
            }
            type="text"
            value={quickDiscount}
            onChange={(e) => setQuickDiscount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const normalized = normalizeNumericInput(
                  quickDiscount.trim(),
                  true,
                );
                if (/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/u.test(normalized)) {
                  const [w = "0", f = ""] = normalized.split(".");
                  onApply(
                    "invoice-discount",
                    (BigInt(w) * 1_000n + BigInt(f.padEnd(3, "0"))).toString(),
                  );
                  setQuickDiscount("");
                }
              }
            }}
          />
          <button
            className="sales-calc-discount-apply-btn"
            disabled={busy || quickDiscount.trim().length === 0}
            type="button"
            onClick={() => {
              const normalized = normalizeNumericInput(
                quickDiscount.trim(),
                true,
              );
              if (/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/u.test(normalized)) {
                const [w = "0", f = ""] = normalized.split(".");
                onApply(
                  "invoice-discount",
                  (BigInt(w) * 1_000n + BigInt(f.padEnd(3, "0"))).toString(),
                );
                setQuickDiscount("");
              }
            }}
          >
            ✓
          </button>
        </div>
      </div>
    </section>
  );
}
