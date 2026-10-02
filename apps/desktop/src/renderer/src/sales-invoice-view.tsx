import { normalizeNumericInput, stepIntegerInput } from "./numeric-input";
import { unitDisplayName } from "../../shared/unit-display";
import type { SaleDraft, SaleDraftLine } from "@breev/contracts/local-rest";
import { useEffect, useState } from "react";

import {
  formatCurrencyFromFils,
  formatNumber,
  formatPercentage,
  type Locale,
} from "./preferences";
import { saleLineEditValues, type SaleLineEdit } from "./sales-line-drafts";

interface InvoiceCopy {
  readonly heading: string;
  readonly empty: string;
  readonly item: string;
  readonly unit: string;
  readonly quantity: string;
  readonly price: string;
  readonly discount: string;
  readonly lineTotal: string;
  readonly actions: string;
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
  readonly collapse: string;
  readonly expand: string;
  readonly itemsCount: string;
}

const invoiceCopy: Record<Locale, InvoiceCopy> = {
  ar: {
    heading: "فاتورة البيع الجارية",
    empty: "امسح باركود أو أضف مادة للبدء",
    item: "اسم المادة",
    unit: "الوحدة",
    quantity: "الكمية",
    price: "السعر",
    discount: "خصم السطر %",
    lineTotal: "الإجمالي",
    actions: "الإجراءات",
    gross: "قبل الخصم",
    lineDiscount: "خصم السطور",
    invoiceDiscount: "خصم الفاتورة (د.ع)",
    total: "المجموع النهائي",
    apply: "تطبيق",
    remove: "حذف السطر",
    increase: "زيادة الكمية",
    decrease: "تقليل الكمية",
    invalidDiscount: "أدخل مبلغاً صحيحاً بالدينار، حتى ثلاثة منازل عشرية.",
    clear: "حذف الفاتورة",
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
    collapse: "طي الفاتورة",
    expand: "توسيع الفاتورة",
    itemsCount: "عدد المواد",
  },
  en: {
    heading: "Current sale invoice",
    empty: "Scan a barcode or add an item to start",
    item: "Item",
    unit: "Unit",
    quantity: "Quantity",
    price: "Price",
    discount: "Line discount %",
    lineTotal: "Total",
    actions: "Actions",
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
    saved: "Draft saved on server",
    saving: "Saving…",
    awaiting: "Awaiting save confirmation — retry",
    unavailable: "This draft cannot be edited.",
    selectLine: "Select line to edit",
    collapse: "Collapse invoice",
    expand: "Expand invoice",
    itemsCount: "Items",
  },
};

function currency(fils: string, locale: Locale): string {
  return formatCurrencyFromFils(BigInt(fils), locale);
}

function parseIqd(input: string): string | null {
  const normalized = normalizeNumericInput(input.trim(), true);
  if (normalized.length === 0) return null;
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/u.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  return (BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0"))).toString();
}

function iqdInput(fils: string): string {
  const value = BigInt(fils);
  const whole = value / 1_000n;
  const fraction = value % 1_000n;
  if (fraction === 0n) return whole.toString();
  return `${whole.toString()}.${fraction.toString().padStart(3, "0").replace(/0+$/u, "")}`;
}

export interface SalesInvoiceViewProps {
  readonly draft: SaleDraft;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly canOverridePrice: boolean;
  readonly pendingConfirmation: boolean;
  readonly readOnly?: boolean;
  readonly selectedLineId: string | null;
  readonly lineEdit: SaleLineEdit | null;
  readonly onEditLine: (lineId: string, edit: SaleLineEdit) => void;
  readonly onSelectLine: (lineId: string | null) => void;
  readonly onOpenProduct: (line: SaleDraftLine) => void;
  readonly onOpenPrice: (line: SaleDraftLine) => void;
  readonly onChangeLine: (
    lineId: string,
    change: {
      readonly quantity?: string;
      readonly unitId?: string;
      readonly lineDiscountPercentage?: string;
    },
  ) => void;
  readonly onRemoveLine: (lineId: string) => void;
  readonly onSetInvoiceDiscount: (fils: string) => void;
  readonly onClear: () => void;
}

function LineEditor({
  line,
  edit,
  onEdit,
  locale,
  busy,
  onChange,
  onRemove,
}: {
  readonly line: SaleDraftLine;
  readonly edit: SaleLineEdit;
  readonly onEdit: (edit: SaleLineEdit) => void;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly onChange: (change: {
    readonly quantity?: string;
    readonly unitId?: string;
    readonly lineDiscountPercentage?: string;
  }) => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const copy = invoiceCopy[locale];
  const quantity = normalizeNumericInput(edit.quantity);
  const unitId = edit.unitId;
  const percentage = normalizeNumericInput(edit.lineDiscountPercentage);

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
          ...(line.kind === "catalog" && unitId !== "" && unitId !== line.unitId
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
            onChange={(event) =>
              onEdit({ ...edit, unitId: event.target.value })
            }
          >
            {line.eligibleUnits.map((unit) => (
              <option key={unit.unitId} value={unit.unitId}>
                {unitDisplayName(unit.unitName, locale)}
              </option>
            ))}
          </select>
        ) : (
          <span>{unitDisplayName(line.unitName, locale)}</span>
        )}
      </label>
      <label>
        {copy.quantity}
        <input
          disabled={busy}
          inputMode="numeric"
          min="1"
          required
          type="text"
          value={edit.quantity}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            const next = stepIntegerInput(
              edit.quantity,
              event.key === "ArrowUp" ? 1 : -1,
              1n,
              undefined,
            );
            if (next !== null) onEdit({ ...edit, quantity: next });
          }}
          onChange={(event) =>
            onEdit({ ...edit, quantity: event.target.value })
          }
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
          type="text"
          value={edit.lineDiscountPercentage}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            const next = stepIntegerInput(
              edit.lineDiscountPercentage,
              event.key === "ArrowUp" ? 1 : -1,
              0n,
              100n,
            );
            if (next !== null)
              onEdit({ ...edit, lineDiscountPercentage: next });
          }}
          onChange={(event) =>
            onEdit({ ...edit, lineDiscountPercentage: event.target.value })
          }
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
  readOnly = false,
  selectedLineId,
  lineEdit,
  onEditLine,
  onSelectLine,
  onOpenProduct,
  onOpenPrice,
  onChangeLine,
  onRemoveLine,
  onSetInvoiceDiscount,
  onClear,
}: SalesInvoiceViewProps): React.JSX.Element {
  const copy = invoiceCopy[locale];
  const [discountInput, setDiscountInput] = useState(
    iqdInput(draft.invoiceDiscountFils),
  );
  const [discountError, setDiscountError] = useState(false);
  const [confirmation, setConfirmation] = useState<"clear" | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
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
      data-collapsed={isCollapsed ? "true" : undefined}
    >
      <div className="sales-invoice-heading">
        <div className="sales-invoice-heading-left">
          <h3>{copy.heading}</h3>
          {draft.lines.length > 0 && isCollapsed ? (
            <span className="sales-invoice-heading-pill">
              {locale === "ar"
                ? `${formatNumber(draft.lines.length, locale)} مواد · ${currency(draft.totals.totalFils, locale)}`
                : `${formatNumber(draft.lines.length, locale)} items · ${currency(draft.totals.totalFils, locale)}`}
            </span>
          ) : null}
        </div>
        <div className="sales-invoice-heading-actions">
          <span aria-live="polite" role="status">
            {readOnly
              ? locale === "ar"
                ? "مسودة معلقة · للقراءة فقط"
                : "Suspended draft · read only"
              : pendingConfirmation
                ? copy.awaiting
                : busy
                  ? copy.saving
                  : copy.saved}
          </span>
          <button
            type="button"
            className="sales-collapse-toggle-btn sales-invoice-collapse-btn"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? copy.expand : copy.collapse}
            title={isCollapsed ? copy.expand : copy.collapse}
            onClick={() => setIsCollapsed((prev) => !prev)}
          >
            <svg
              aria-hidden="true"
              className="sales-collapse-icon"
              fill="none"
              height="14"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="14"
            >
              <path d={isCollapsed ? "M6 9l6 6 6-6" : "M6 15l6-6 6 6"} />
            </svg>
            <span>{isCollapsed ? copy.expand : copy.collapse}</span>
          </button>
        </div>
      </div>

      <div className="sales-invoice-table-wrap">
        {draft.lines.length === 0 ? (
          <div className="sales-invoice-empty-wrap">
            <p className="sales-invoice-empty">{copy.empty}</p>
          </div>
        ) : (
          <table className="sales-invoice-table">
            <thead>
              <tr>
                <th scope="col" className="sales-col-num">
                  #
                </th>
                <th scope="col" className="sales-col-item">
                  {copy.item}
                </th>
                <th scope="col" className="sales-col-unit">
                  {copy.unit}
                </th>
                <th scope="col" className="sales-col-qty">
                  {copy.quantity}
                </th>
                <th scope="col" className="sales-col-price">
                  {copy.price}
                </th>
                <th scope="col" className="sales-col-total">
                  {copy.lineTotal}
                </th>
                <th scope="col" className="sales-col-actions">
                  {copy.actions}
                </th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((line, index) => {
                const isSelected = selectedLineId === line.id;
                const hasDiscount = line.lineDiscountPercentage !== "0";
                return (
                  <tr
                    data-sale-line-id={line.id}
                    data-selected={isSelected || undefined}
                    key={line.id}
                    onClick={() => onSelectLine(line.id)}
                  >
                    <td className="sales-col-num">
                      {formatNumber(index + 1, locale)}
                    </td>
                    <td className="sales-col-item">
                      <div className="sales-line-name-wrap">
                        <button
                          aria-label={`${copy.selectLine}: ${line.displayName}`}
                          className="sales-line-select"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectLine(line.id);
                          }}
                        >
                          {line.displayName}
                        </button>
                        {line.productId === null ? null : (
                          <button
                            aria-label={`${locale === "ar" ? "فتح سجل المادة" : "Open item record"}: ${line.displayName}`}
                            className="sales-line-open-product"
                            data-sale-line-record={line.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenProduct(line);
                            }}
                          >
                            ↗
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="sales-col-unit">
                      <span className="sales-line-unit-badge">
                        {unitDisplayName(line.unitName, locale)}
                      </span>
                    </td>
                    <td
                      className="sales-col-qty sales-quantity-cell"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        aria-label={`${copy.decrease}: ${line.displayName}`}
                        disabled={readOnly || busy || line.quantity === "1"}
                        type="button"
                        onClick={() =>
                          onChangeLine(line.id, {
                            quantity: String(BigInt(line.quantity) - 1n),
                          })
                        }
                      >
                        −
                      </button>
                      <span className="sales-quantity-val">
                        {formatNumber(BigInt(line.quantity), locale)}
                      </span>
                      <button
                        aria-label={`${copy.increase}: ${line.displayName}`}
                        disabled={readOnly || busy}
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
                    <td className="sales-col-price">
                      {!readOnly &&
                      canOverridePrice &&
                      line.kind === "catalog" ? (
                        <button
                          aria-label={`${locale === "ar" ? "تغيير سعر السطر" : "Change line price"}: ${line.displayName}`}
                          className="sales-line-price-button"
                          disabled={busy}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenPrice(line);
                          }}
                        >
                          {currency(line.unitPriceFils, locale)}
                        </button>
                      ) : (
                        <span>{currency(line.unitPriceFils, locale)}</span>
                      )}
                    </td>
                    <td className="sales-col-total">
                      <div className="sales-line-total-cell">
                        <strong>{currency(line.totalFils, locale)}</strong>
                        {hasDiscount ? (
                          <span className="sales-line-discount-tag">
                            -
                            {formatPercentage(
                              line.lineDiscountPercentage,
                              locale,
                            )}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td
                      className="sales-col-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        aria-label={`${copy.remove}: ${line.displayName}`}
                        className="sales-line-remove-btn"
                        disabled={readOnly || busy}
                        type="button"
                        onClick={() => {
                          onRemoveLine(line.id);
                          if (selectedLineId === line.id) {
                            onSelectLine(null);
                          }
                        }}
                      >
                        <svg
                          aria-hidden="true"
                          fill="none"
                          height="14"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                          width="14"
                        >
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selectedLine === null || readOnly ? null : (
        <LineEditor
          busy={busy}
          key={selectedLine.id}
          line={selectedLine}
          edit={lineEdit ?? saleLineEditValues(selectedLine)}
          onEdit={(edit) => onEditLine(selectedLine.id, edit)}
          locale={locale}
          onChange={(change) => onChangeLine(selectedLine.id, change)}
          onRemove={() => {
            onRemoveLine(selectedLine.id);
            onSelectLine(null);
          }}
        />
      )}

      <div className="sales-invoice-summary">
        <div className="sales-invoice-final">
          <span className="sales-invoice-final-label">{copy.total}</span>
          <strong className="sales-invoice-final-amount">
            {currency(draft.totals.totalFils, locale)}
          </strong>
        </div>

        <div className="sales-invoice-meta-row">
          <span className="sales-invoice-item-count">
            {copy.itemsCount}:{" "}
            <strong>
              {formatNumber(BigInt(draft.lines.length), locale).padStart(
                2,
                "0",
              )}
            </strong>
          </span>

          <dl className="sales-invoice-breakdown">
            <div>
              <dt>{copy.gross}</dt>
              <dd>{currency(draft.totals.grossFils, locale)}</dd>
            </div>
            {BigInt(draft.totals.lineDiscountFils) > 0n ? (
              <div>
                <dt>{copy.lineDiscount}</dt>
                <dd>{currency(draft.totals.lineDiscountFils, locale)}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        {readOnly ? null : (
          <form
            className="sales-invoice-inline-discount"
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
            <label htmlFor="sale-invoice-discount">
              {copy.invoiceDiscount}
            </label>
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
        )}
      </div>

      {readOnly ? null : (
        <div className="sales-invoice-actions">
          {confirmation === null ? (
            <button
              className="sales-clear-invoice-btn"
              disabled={busy || draft.lines.length === 0}
              type="button"
              onClick={() => setConfirmation("clear")}
            >
              {copy.clear}
            </button>
          ) : (
            <div
              className="sales-invoice-confirm"
              role="group"
              aria-label={copy.confirmClear}
            >
              <span>{copy.confirmClear}</span>
              <button
                disabled={busy}
                type="button"
                onClick={() => {
                  onClear();
                  setConfirmation(null);
                }}
              >
                {copy.clear}
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
      )}
    </section>
  );
}
