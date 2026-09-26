import type { SaleDraft, SaleDraftLine } from "@breev/contracts/local-rest";
import { useEffect, useState } from "react";

import {
  formatCurrencyFromFils,
  formatNumber,
  type Locale,
} from "./preferences";

interface InvoiceCopy {
  readonly heading: string;
  readonly empty: string;
  readonly item: string;
  readonly unit: string;
  readonly quantity: string;
  readonly price: string;
  readonly discount: string;
  readonly lineTotal: string;
  readonly gross: string;
  readonly lineDiscount: string;
  readonly invoiceDiscount: string;
  readonly total: string;
  readonly apply: string;
  readonly remove: string;
  readonly increase: string;
  readonly decrease: string;
  readonly invalidDiscount: string;
  readonly clear: string;
  readonly suspend: string;
  readonly discard: string;
  readonly confirmClear: string;
  readonly confirmDiscard: string;
  readonly cancel: string;
  readonly saved: string;
  readonly saving: string;
  readonly awaiting: string;
  readonly unavailable: string;
  readonly selectLine: string;
}

const invoiceCopy: Record<Locale, InvoiceCopy> = {
  ar: {
    heading: "فاتورة البيع الجارية",
    empty: "المسودة فارغة. ابحث عن مادة وأضفها إلى الفاتورة.",
    item: "المادة",
    unit: "الوحدة",
    quantity: "الكمية",
    price: "السعر",
    discount: "خصم السطر %",
    lineTotal: "الإجمالي",
    gross: "قبل الخصم",
    lineDiscount: "خصم السطور",
    invoiceDiscount: "خصم الفاتورة (د.ع)",
    total: "المجموع النهائي",
    apply: "تطبيق",
    remove: "حذف السطر",
    increase: "زيادة الكمية",
    decrease: "تقليل الكمية",
    invalidDiscount: "أدخل مبلغاً صحيحاً بالدينار، حتى ثلاثة منازل عشرية.",
    clear: "إفراغ الفاتورة",
    suspend: "تعليق المسودة",
    discard: "استبعاد المسودة",
    confirmClear: "سيُحذف كل سطر وخصم من هذه المسودة. هل تريد المتابعة؟",
    confirmDiscard: "سيُستبعد هذا البيع غير المكتمل. هل تريد المتابعة؟",
    cancel: "إلغاء",
    saved: "حُفظت المسودة على الخادم",
    saving: "جارٍ الحفظ…",
    awaiting: "بانتظار تأكيد الحفظ — أعد المحاولة",
    unavailable: "لا يمكن تعديل هذه المسودة.",
    selectLine: "اختر سطراً لتعديله",
  },
  en: {
    heading: "Current sale invoice",
    empty: "This draft is empty. Search for an item and add it to the sale.",
    item: "Item",
    unit: "Unit",
    quantity: "Quantity",
    price: "Price",
    discount: "Line discount %",
    lineTotal: "Total",
    gross: "Before discounts",
    lineDiscount: "Line discounts",
    invoiceDiscount: "Invoice discount (IQD)",
    total: "Final total",
    apply: "Apply",
    remove: "Remove line",
    increase: "Increase quantity",
    decrease: "Decrease quantity",
    invalidDiscount: "Enter an IQD amount with at most three decimal places.",
    clear: "Clear invoice",
    suspend: "Suspend draft",
    discard: "Discard draft",
    confirmClear:
      "This removes every line and discount from this draft. Continue?",
    confirmDiscard: "This discards the unfinished sale. Continue?",
    cancel: "Cancel",
    saved: "Draft saved on the server",
    saving: "Saving…",
    awaiting: "Save unconfirmed — retry the edit",
    unavailable: "This draft cannot be edited.",
    selectLine: "Select a line to edit it",
  },
};

type LineChange = {
  readonly quantity: string;
  readonly unitId: string;
  readonly lineDiscountPercentage: string;
};

export interface SalesInvoiceViewProps {
  readonly draft: SaleDraft;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly canOverridePrice: boolean;
  readonly pendingConfirmation: boolean;
  readonly selectedLineId: string | null;
  readonly onSelectLine: (lineId: string | null) => void;
  readonly onOpenProduct: (line: SaleDraftLine) => void;
  readonly onOpenPrice: (line: SaleDraftLine) => void;
  readonly onChangeLine: (lineId: string, change: Partial<LineChange>) => void;
  readonly onRemoveLine: (lineId: string) => void;
  readonly onSetInvoiceDiscount: (fils: string) => void;
  readonly onClear: () => void;
  readonly onSuspend: () => void;
  readonly onDiscard: () => void;
}

function currency(value: string, locale: Locale): string {
  return formatCurrencyFromFils(BigInt(value), locale);
}

function iqdInput(value: string): string {
  const fils = BigInt(value);
  const whole = fils / 1_000n;
  const remainder = fils % 1_000n;
  return remainder === 0n
    ? String(whole)
    : `${whole}.${String(remainder).padStart(3, "0").replace(/0+$/u, "")}`;
}

function parseIqd(value: string): string | null {
  const normalized = value.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/u.test(normalized)) return null;
  const [whole = "0", fractional = ""] = normalized.split(".");
  return (
    BigInt(whole) * 1_000n +
    BigInt(fractional.padEnd(3, "0"))
  ).toString();
}

function LineEditor({
  busy,
  line,
  locale,
  onChange,
  onRemove,
}: {
  readonly busy: boolean;
  readonly line: SaleDraftLine;
  readonly locale: Locale;
  readonly onChange: (change: Partial<LineChange>) => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const copy = invoiceCopy[locale];
  const [unitId, setUnitId] = useState(line.unitId ?? "");
  const [quantity, setQuantity] = useState(line.quantity);
  const [percentage, setPercentage] = useState(line.lineDiscountPercentage);
  useEffect(() => {
    setUnitId(line.unitId ?? "");
    setQuantity(line.quantity);
    setPercentage(line.lineDiscountPercentage);
  }, [line.id, line.quantity, line.unitId, line.lineDiscountPercentage]);

  return (
    <form
      className="sales-line-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !/^[1-9][0-9]*$/u.test(quantity) ||
          !/^(100|[1-9]?[0-9])$/u.test(percentage)
        )
          return;
        onChange({
          ...(line.kind === "catalog" && unitId !== line.unitId
            ? { unitId }
            : {}),
          ...(quantity === line.quantity ? {} : { quantity }),
          ...(percentage === line.lineDiscountPercentage
            ? {}
            : { lineDiscountPercentage: percentage }),
        });
      }}
    >
      <strong>{line.displayName}</strong>
      <label>
        {copy.unit}
        {line.kind === "catalog" ? (
          <select
            disabled={busy}
            value={unitId}
            onChange={(event) => setUnitId(event.target.value)}
          >
            {line.eligibleUnits.map((unit) => (
              <option key={unit.unitId} value={unit.unitId}>
                {unit.unitName}
              </option>
            ))}
          </select>
        ) : (
          <span>{line.unitName}</span>
        )}
      </label>
      <label>
        {copy.quantity}
        <input
          disabled={busy}
          inputMode="numeric"
          min="1"
          required
          type="number"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </label>
      <label>
        {copy.discount}
        <input
          disabled={busy}
          inputMode="numeric"
          max="100"
          min="0"
          required
          type="number"
          value={percentage}
          onChange={(event) => setPercentage(event.target.value)}
        />
      </label>
      <div className="sales-line-editor-actions">
        <button disabled={busy} type="submit">
          {copy.apply}
        </button>
        <button disabled={busy} type="button" onClick={onRemove}>
          {copy.remove}
        </button>
      </div>
    </form>
  );
}

export function SalesInvoiceView({
  draft,
  locale,
  busy,
  canOverridePrice,
  pendingConfirmation,
  selectedLineId,
  onSelectLine,
  onOpenProduct,
  onOpenPrice,
  onChangeLine,
  onRemoveLine,
  onSetInvoiceDiscount,
  onClear,
  onSuspend,
  onDiscard,
}: SalesInvoiceViewProps): React.JSX.Element {
  const copy = invoiceCopy[locale];
  const [discountInput, setDiscountInput] = useState(
    iqdInput(draft.invoiceDiscountFils),
  );
  const [discountError, setDiscountError] = useState(false);
  const [confirmation, setConfirmation] = useState<"clear" | "discard" | null>(
    null,
  );
  const selectedLine =
    draft.lines.find((line) => line.id === selectedLineId) ?? null;
  useEffect(() => {
    setDiscountInput(iqdInput(draft.invoiceDiscountFils));
    setDiscountError(false);
  }, [draft.invoiceDiscountFils]);

  return (
    <section
      aria-label={copy.heading}
      className="sales-invoice"
      data-sale-invoice={draft.id}
    >
      <div className="sales-invoice-heading">
        <h3>{copy.heading}</h3>
        <span aria-live="polite" role="status">
          {pendingConfirmation
            ? copy.awaiting
            : busy
              ? copy.saving
              : copy.saved}
        </span>
      </div>
      <div className="sales-invoice-table-wrap">
        {draft.lines.length === 0 ? (
          <p className="sales-invoice-empty">{copy.empty}</p>
        ) : (
          <table className="sales-invoice-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{copy.item}</th>
                <th scope="col">{copy.unit}</th>
                <th scope="col">{copy.quantity}</th>
                <th scope="col">{copy.price}</th>
                <th scope="col">{copy.discount}</th>
                <th scope="col">{copy.lineTotal}</th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((line, index) => (
                <tr
                  data-sale-line-id={line.id}
                  data-selected={selectedLineId === line.id || undefined}
                  key={line.id}
                >
                  <td>{formatNumber(index + 1, locale)}</td>
                  <td>
                    <button
                      aria-label={`${copy.selectLine}: ${line.displayName}`}
                      className="sales-line-select"
                      type="button"
                      onClick={() => onSelectLine(line.id)}
                    >
                      {line.displayName}
                    </button>
                    {line.productId === null ? null : (
                      <button
                        aria-label={`${locale === "ar" ? "فتح سجل المادة" : "Open item record"}: ${line.displayName}`}
                        className="sales-line-open-product"
                        data-sale-line-record={line.id}
                        type="button"
                        onClick={() => onOpenProduct(line)}
                      >
                        ↗
                      </button>
                    )}
                  </td>
                  <td>{line.unitName}</td>
                  <td className="sales-quantity-cell">
                    <button
                      aria-label={`${copy.decrease}: ${line.displayName}`}
                      disabled={busy || line.quantity === "1"}
                      type="button"
                      onClick={() =>
                        onChangeLine(line.id, {
                          quantity: String(BigInt(line.quantity) - 1n),
                        })
                      }
                    >
                      −
                    </button>
                    <span>{formatNumber(BigInt(line.quantity), locale)}</span>
                    <button
                      aria-label={`${copy.increase}: ${line.displayName}`}
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        onChangeLine(line.id, {
                          quantity: String(BigInt(line.quantity) + 1n),
                        })
                      }
                    >
                      +
                    </button>
                  </td>
                  <td>
                    {canOverridePrice && line.kind === "catalog" ? (
                      <button
                        aria-label={`${locale === "ar" ? "تغيير سعر السطر" : "Change line price"}: ${line.displayName}`}
                        className="sales-line-price-button"
                        disabled={busy}
                        type="button"
                        onClick={() => onOpenPrice(line)}
                      >
                        {currency(line.unitPriceFils, locale)}
                      </button>
                    ) : (
                      currency(line.unitPriceFils, locale)
                    )}
                  </td>
                  <td>
                    {formatNumber(BigInt(line.lineDiscountPercentage), locale)}%
                  </td>
                  <td>{currency(line.totalFils, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {selectedLine === null ? null : (
        <LineEditor
          busy={busy}
          key={selectedLine.id}
          line={selectedLine}
          locale={locale}
          onChange={(change) => onChangeLine(selectedLine.id, change)}
          onRemove={() => {
            onRemoveLine(selectedLine.id);
            onSelectLine(null);
          }}
        />
      )}
      <div className="sales-invoice-summary">
        <dl>
          <div>
            <dt>{copy.gross}</dt>
            <dd>{currency(draft.totals.grossFils, locale)}</dd>
          </div>
          <div>
            <dt>{copy.lineDiscount}</dt>
            <dd>{currency(draft.totals.lineDiscountFils, locale)}</dd>
          </div>
        </dl>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const fils = parseIqd(discountInput);
            if (fils === null) {
              setDiscountError(true);
              return;
            }
            setDiscountError(false);
            onSetInvoiceDiscount(fils);
          }}
        >
          <label htmlFor="sale-invoice-discount">{copy.invoiceDiscount}</label>
          <input
            disabled={busy}
            id="sale-invoice-discount"
            inputMode="decimal"
            type="text"
            value={discountInput}
            onChange={(event) => setDiscountInput(event.target.value)}
          />
          <button disabled={busy} type="submit">
            {copy.apply}
          </button>
          {discountError ? (
            <span role="alert">{copy.invalidDiscount}</span>
          ) : null}
        </form>
        <div className="sales-invoice-final">
          <span>{copy.total}</span>
          <strong>{currency(draft.totals.totalFils, locale)}</strong>
        </div>
      </div>
      <div className="sales-invoice-actions">
        {confirmation === null ? (
          <>
            <button
              disabled={busy || draft.lines.length === 0}
              type="button"
              onClick={() => setConfirmation("clear")}
            >
              {copy.clear}
            </button>
            <button disabled={busy} type="button" onClick={onSuspend}>
              {copy.suspend}
            </button>
            <button
              disabled={busy}
              type="button"
              onClick={() => setConfirmation("discard")}
            >
              {copy.discard}
            </button>
          </>
        ) : (
          <div
            className="sales-invoice-confirm"
            role="group"
            aria-label={
              confirmation === "clear" ? copy.confirmClear : copy.confirmDiscard
            }
          >
            <span>
              {confirmation === "clear"
                ? copy.confirmClear
                : copy.confirmDiscard}
            </span>
            <button
              disabled={busy}
              type="button"
              onClick={() => {
                if (confirmation === "clear") onClear();
                else onDiscard();
                setConfirmation(null);
              }}
            >
              {confirmation === "clear" ? copy.clear : copy.discard}
            </button>
            <button
              disabled={busy}
              type="button"
              onClick={() => setConfirmation(null)}
            >
              {copy.cancel}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
