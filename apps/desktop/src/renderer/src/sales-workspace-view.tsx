import type {
  SaleDraft,
  SaleDraftLine,
  SaleProductContext,
} from "@breev/contracts/local-rest";
import type { ReactNode } from "react";

import { Card, CardContent } from "./components/ui/card";
import {
  formatCurrencyFromFils,
  formatDateTime,
  formatNumber,
} from "./preferences";
import type { Locale } from "./preferences";
import { salesUpdatedLabel, type SalesCopy } from "./sales-messages";

export interface SalesWorkspaceViewProps {
  readonly activeDraftId: string | null;
  readonly activeDraftLabel: string;
  readonly busy: boolean;
  readonly children: ReactNode;
  readonly copy: SalesCopy;
  readonly confirmNewDraft: boolean;
  readonly createDisabled: boolean;
  readonly drafts: readonly SaleDraft[] | null;
  readonly draftsError: string | null;
  readonly locale: Locale;
  readonly onCreateDraft: () => void;
  readonly onConfirmNewDraft: () => void;
  readonly onCancelNewDraft: () => void;
  readonly onReloadDrafts: () => void;
  readonly onResumeDraft: (draft: SaleDraft) => void;
  readonly onSelectDraft: (draft: SaleDraft) => void;
  readonly onFocusEditor: () => void;
}

export interface SalesDraftContextPanelProps {
  readonly copy: SalesCopy;
  readonly draft: SaleDraft;
  readonly locale: Locale;
  readonly selectedLine: SaleDraftLine | null;
  readonly itemContext: SaleProductContext | null;
  readonly itemContextUnavailable: boolean;
  readonly onToggleCollapse?: () => void;
}

export function SalesDraftContextPanel({
  copy,
  draft,
  locale,
  selectedLine,
  itemContext,
  itemContextUnavailable,
  onToggleCollapse,
}: SalesDraftContextPanelProps): React.JSX.Element {
  const updatedAt = new Date(draft.updatedAt);
  const itemCopy =
    locale === "ar"
      ? {
          heading: "تفاصيل المادة المحددة",
          unit: "الوحدة",
          capturedPrice: "سعر البيع في المسودة",
          currentPrice: "سعر البيع الحالي",
          scientific: "الاسم العلمي",
          packaging: "التعبئة",
          minimum: "الحد الأدنى",
          maximum: "الحد الأقصى",
          balance: "الرصيد الفعلي",
          surplus: "الفائض التقديري",
          maximumNotSet: "الحد الأقصى غير محدد",
          noStockRecord: "لا توجد حركة مخزون مسجلة",
          batches: "الدفعات المسجلة",
          batch: "دفعة",
          expiry: "انتهاء الصلاحية",
          noExpiry: "لم يسجل تاريخ انتهاء",
          daysRemaining: (days: number) =>
            `${formatNumber(days, locale)} يوم متبقٍ`,
          daysExpired: (days: number) =>
            `منتهية منذ ${formatNumber(days, locale)} يوم`,
          batchStatus: {
            eligible: "صالحة",
            "near-expiry": "قريبة الانتهاء",
            expired: "منتهية",
            recalled: "مستدعاة",
            quarantined: "محجوزة",
            "postponed-blocked": "محظورة مؤقتاً",
          },
          unavailable: "غير متاح لهذا المستخدم",
          notSet: "غير محدد",
        }
      : {
          heading: "Selected item details",
          unit: "Unit",
          capturedPrice: "Draft selling price",
          currentPrice: "Current retail price",
          scientific: "Scientific name",
          packaging: "Packaging",
          minimum: "Minimum level",
          maximum: "Maximum level",
          balance: "On-hand balance",
          surplus: "Estimated surplus",
          maximumNotSet: "Maximum not set",
          noStockRecord: "No stock movement recorded",
          batches: "Recorded batches",
          batch: "Batch",
          expiry: "Expiry",
          noExpiry: "No expiry recorded",
          daysRemaining: (days: number) =>
            `${formatNumber(days, locale)} days remaining`,
          daysExpired: (days: number) =>
            `Expired ${formatNumber(days, locale)} days ago`,
          batchStatus: {
            eligible: "Eligible",
            "near-expiry": "Near expiry",
            expired: "Expired",
            recalled: "Recalled",
            quarantined: "Quarantined",
            "postponed-blocked": "Temporarily blocked",
          },
          unavailable: "Unavailable for this user",
          notSet: "Not set",
        };

  return (
    <aside
      aria-labelledby="sales-draft-context-title"
      className="sales-draft-context"
      data-sales-pane="draft-context"
    >
      {selectedLine === null ? null : (
        <section className="sales-item-context" aria-label={itemCopy.heading}>
          <div className="sales-item-context-header">
            <h3>{itemCopy.heading}</h3>
            {onToggleCollapse ? (
              <button
                type="button"
                className="sales-collapse-toggle-btn sales-context-collapse-btn"
                aria-label={
                  locale === "ar"
                    ? "طي تفاصيل المادة"
                    : "Collapse product details"
                }
                title={
                  locale === "ar"
                    ? "طي تفاصيل المادة"
                    : "Collapse product details"
                }
                onClick={onToggleCollapse}
              >
                ✕
              </button>
            ) : null}
          </div>
          <strong>{selectedLine.displayName}</strong>
          <dl>
            <div>
              <dt>{itemCopy.unit}</dt>
              <dd>{selectedLine.unitName}</dd>
            </div>
            <div>
              <dt>{itemCopy.capturedPrice}</dt>
              <dd>
                {formatCurrencyFromFils(
                  BigInt(selectedLine.unitPriceFils),
                  locale,
                )}
              </dd>
            </div>
            {itemContext === null ? null : (
              <>
                <div>
                  <dt>{itemCopy.currentPrice}</dt>
                  <dd>
                    {formatCurrencyFromFils(
                      BigInt(itemContext.currentRetailPriceFils),
                      locale,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{itemCopy.scientific}</dt>
                  <dd>{itemContext.scientificName ?? itemCopy.notSet}</dd>
                </div>
                <div>
                  <dt>{itemCopy.packaging}</dt>
                  <dd>
                    {itemContext.packageUnits
                      .map(
                        (unit) =>
                          `${unit.name} = ${unit.baseUnitsPerPackage} ${itemContext.inventoryUnitName}`,
                      )
                      .join(" · ") || itemContext.inventoryUnitName}
                  </dd>
                </div>
                <div>
                  <dt>{itemCopy.minimum}</dt>
                  <dd>
                    {itemContext.stockLevels.minimumLevel ?? itemCopy.notSet}
                  </dd>
                </div>
                <div>
                  <dt>{itemCopy.maximum}</dt>
                  <dd>
                    {itemContext.stockLevels.maximumLevel ?? itemCopy.notSet}
                  </dd>
                </div>
                <div>
                  <dt>{itemCopy.balance}</dt>
                  <dd>
                    {itemContext.inventory.onHandBaseUnits === null
                      ? itemCopy.noStockRecord
                      : `${formatNumber(BigInt(itemContext.inventory.onHandBaseUnits), locale)} ${itemContext.inventoryUnitName}`}
                  </dd>
                </div>
                <div>
                  <dt>{itemCopy.surplus}</dt>
                  <dd>
                    {itemContext.stockLevels.maximumLevel === null
                      ? itemCopy.maximumNotSet
                      : itemContext.inventory.estimatedSurplusBaseUnits === null
                        ? itemCopy.noStockRecord
                        : `${formatNumber(BigInt(itemContext.inventory.estimatedSurplusBaseUnits), locale)} ${itemContext.inventoryUnitName}`}
                  </dd>
                </div>
              </>
            )}
          </dl>
          {itemContext === null ||
          itemContext.inventory.batches.length === 0 ? null : (
            <section
              className="sales-item-batches"
              aria-label={itemCopy.batches}
            >
              <h4>{itemCopy.batches}</h4>
              <ul>
                {itemContext.inventory.batches.map((batch) => (
                  <li key={batch.batchId}>
                    <strong>
                      {batch.lotNumber ??
                        `${itemCopy.batch} ${batch.batchId.slice(0, 8)}`}
                    </strong>
                    <span>
                      {formatNumber(BigInt(batch.balanceBaseUnits), locale)}{" "}
                      {itemContext.inventoryUnitName}
                    </span>
                    <span>{itemCopy.batchStatus[batch.status]}</span>
                    <span>
                      {itemCopy.expiry}:{" "}
                      {batch.effectiveExpiryDate === null
                        ? itemCopy.noExpiry
                        : batch.effectiveExpiryDate}
                      {batch.daysRemaining === null
                        ? null
                        : ` · ${
                            batch.daysRemaining < 0
                              ? itemCopy.daysExpired(
                                  Math.abs(batch.daysRemaining),
                                )
                              : itemCopy.daysRemaining(batch.daysRemaining)
                          }`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {itemContextUnavailable ? (
            <p role="status">{itemCopy.unavailable}</p>
          ) : null}
        </section>
      )}
      <Card className="sales-draft-context-card" data-sale-draft-id={draft.id}>
        <header className="sales-draft-context-header">
          <h3 id="sales-draft-context-title">{copy.activeDraft}</h3>
          {onToggleCollapse ? (
            <button
              type="button"
              className="sales-collapse-toggle-btn sales-context-collapse-btn"
              aria-label={
                locale === "ar"
                  ? "طي تفاصيل المادة"
                  : "Collapse product details"
              }
              title={
                locale === "ar"
                  ? "طي تفاصيل المادة"
                  : "Collapse product details"
              }
              onClick={onToggleCollapse}
            >
              ✕
            </button>
          ) : null}
        </header>
        <CardContent className="sales-draft-context-content">
          <p>{copy.openedBy(draft.createdBy.displayName)}</p>
          <p>
            <span className="sales-draft-context-label">
              {salesUpdatedLabel(locale)}
            </span>
            <time dateTime={draft.updatedAt}>
              {formatDateTime(updatedAt, locale)}
            </time>
          </p>
          <p data-sale-draft-version={draft.version}>
            {copy.versionLabel(formatNumber(BigInt(draft.version), locale))}
          </p>
        </CardContent>
      </Card>
    </aside>
  );
}

function PlusIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="sales-btn-icon"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

export function SalesWorkspaceView({
  activeDraftId,
  activeDraftLabel,
  busy,
  children,
  copy,
  confirmNewDraft,
  createDisabled,
  drafts,
  draftsError,
  locale,
  onCreateDraft,
  onConfirmNewDraft,
  onCancelNewDraft,
  onReloadDrafts,
  onResumeDraft,
  onSelectDraft,
  onFocusEditor,
}: SalesWorkspaceViewProps): React.JSX.Element {
  const ordered = [...(drafts ?? [])].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
  const position = ordered.findIndex((draft) => draft.id === activeDraftId);
  const selected = position < 0 ? null : ordered[position]!;
  return (
    <div className="sales-workspace">
      <section
        aria-labelledby="sales-draft-tray-title"
        className="sales-draft-tray"
      >
        <div className="sales-draft-tray-header">
          <div className="sales-draft-tray-heading-group">
            <h2 id="sales-draft-tray-title">{copy.draftsHeading}</h2>
            {ordered.length > 0 ? (
              <span
                aria-label={copy.draftsHeading}
                className="sales-draft-count-badge"
              >
                {formatNumber(BigInt(ordered.length), locale)}
              </span>
            ) : null}
          </div>
          <div className="sales-draft-navigation">
            <select
              aria-label={locale === "ar" ? "اختيار مسودة" : "Choose draft"}
              data-sale-draft-control="select"
              disabled={busy || ordered.length === 0}
              onChange={(event) => {
                const draft = ordered.find(
                  (item) => item.id === event.target.value,
                );
                if (draft) onSelectDraft(draft);
              }}
              value={selected?.id ?? ""}
            >
              <option value="">
                {locale === "ar" ? "اختر مسودة" : "Choose draft"}
              </option>
              {ordered.map((draft, index) => (
                <option key={draft.id} value={draft.id}>
                  {formatNumber(BigInt(index + 1), locale)} ·{" "}
                  {draft.status === "active" ? activeDraftLabel : copy.resume}
                </option>
              ))}
            </select>
            <button
              aria-label={
                locale === "ar" ? "المسودة السابقة" : "Previous draft"
              }
              data-sale-draft-control="previous"
              disabled={busy || position <= 0}
              onClick={() => onSelectDraft(ordered[position - 1]!)}
              type="button"
            >
              ‹
            </button>
            <span
              aria-live="polite"
              data-sale-draft-version={selected?.version}
            >
              {selected === null
                ? locale === "ar"
                  ? "لم تُحدد مسودة"
                  : "No draft selected"
                : `${formatNumber(BigInt(position + 1), locale)} / ${formatNumber(BigInt(ordered.length), locale)} · ${selected.status === "active" ? (locale === "ar" ? "نشطة" : "Active") : locale === "ar" ? "معلقة" : "Suspended"}`}
            </span>
            <button
              aria-label={locale === "ar" ? "المسودة التالية" : "Next draft"}
              data-sale-draft-control="next"
              disabled={busy || position < 0 || position >= ordered.length - 1}
              onClick={() => onSelectDraft(ordered[position + 1]!)}
              type="button"
            >
              ›
            </button>
          </div>
          <button
            data-sale-draft-control="edit"
            disabled={busy || selected === null}
            onClick={() =>
              selected?.status === "suspended"
                ? onResumeDraft(selected)
                : onFocusEditor()
            }
            type="button"
          >
            {locale === "ar" ? "تعديل" : "Edit"}
          </button>
          <button
            data-sale-draft-control="save"
            disabled
            aria-describedby="sales-save-gate"
            type="button"
          >
            {locale === "ar" ? "حفظ" : "Save"}
          </button>
          <button
            className="sales-new-draft"
            data-sale-draft-control="new"
            disabled={createDisabled}
            type="button"
            onClick={onCreateDraft}
          >
            <PlusIcon />
            <span>{locale === "ar" ? "جديد" : "New"}</span>
          </button>
        </div>

        {confirmNewDraft ? (
          <div
            className="sales-new-confirm"
            role="group"
            aria-label={
              locale === "ar" ? "تأكيد مسودة جديدة" : "Confirm new sale draft"
            }
          >
            <p>
              {locale === "ar"
                ? "تحتوي المسودة الحالية على مواد. ستبقى محفوظة عند فتح مسودة جديدة."
                : "The current draft has items. It will stay saved when you open a new draft."}
            </p>
            <button disabled={busy} type="button" onClick={onConfirmNewDraft}>
              {locale === "ar" ? "فتح مسودة جديدة" : "Open new draft"}
            </button>
            <button disabled={busy} type="button" onClick={onCancelNewDraft}>
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </button>
          </div>
        ) : null}

        <div
          aria-busy={drafts === null && draftsError === null}
          className="sales-draft-tray-content"
        >
          {draftsError === null ? null : (
            <div className="sales-draft-list-error" role="status">
              <p>{draftsError}</p>
              <button
                data-sale-draft-control="draft-list-reload"
                disabled={busy}
                type="button"
                onClick={onReloadDrafts}
              >
                {copy.reload}
              </button>
            </div>
          )}

          {drafts === null ? (
            draftsError === null ? (
              <p className="sales-draft-list-state" role="status">
                {copy.loading}
              </p>
            ) : null
          ) : ordered.length === 0 ? (
            <p className="sales-draft-list-state">{copy.empty}</p>
          ) : selected === null ? null : (
            <p
              className="sales-draft-tray-meta"
              data-sale-draft-row={selected.id}
            >
              {copy.draftHeading(
                formatDateTime(new Date(selected.createdAt), locale),
              )}{" "}
              · {copy.openedBy(selected.createdBy.displayName)} ·{" "}
              {copy.versionLabel(
                formatNumber(BigInt(selected.version), locale),
              )}
            </p>
          )}
        </div>
      </section>

      <div className="sales-workspace-main">{children}</div>
    </div>
  );
}
