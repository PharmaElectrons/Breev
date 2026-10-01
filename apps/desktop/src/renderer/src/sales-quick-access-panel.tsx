import type { SaleQuickAccess } from "@breev/contracts/local-rest";

import { formatCurrencyFromFils } from "./preferences";
import type { Locale } from "./preferences";

export function SaleQuickAccessPanel({
  value,
  locale,
  busy,
  error,
  canManage,
  onReload,
  onAdd,
  onRemove,
  onRemoveCategory,
  onMoveTile,
  onMoveCategory,
}: {
  readonly value: SaleQuickAccess | null;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly error: string | null;
  readonly canManage: boolean;
  readonly onReload: () => void;
  readonly onAdd: (productId: string, unitId: string) => void;
  readonly onRemove: (categoryIndex: number, tileIndex: number) => void;
  readonly onRemoveCategory: (categoryIndex: number) => void;
  readonly onMoveTile: (
    categoryIndex: number,
    tileIndex: number,
    change: -1 | 1,
  ) => void;
  readonly onMoveCategory: (categoryIndex: number, change: -1 | 1) => void;
}): React.JSX.Element {
  const ar = locale === "ar";
  return (
    <section
      className="sales-quick-access"
      aria-label={ar ? "الوصول السريع" : "Quick access"}
    >
      <header>
        <h3>{ar ? "الوصول السريع" : "Quick access"}</h3>
        {error === null ? null : (
          <button type="button" onClick={onReload}>
            {ar ? "إعادة التحميل" : "Reload"}
          </button>
        )}
      </header>
      {error === null ? null : <p role="status">{error}</p>}
      {value !== null && value.categories.length === 0 && canManage ? (
        <p>
          {ar
            ? "ابحث عن مادة ثم ثبّتها هنا."
            : "Search for an item, then pin it here."}
        </p>
      ) : null}
      {value === null || value.categories.length === 0
        ? null
        : value.categories.map((category, categoryIndex) => (
            <div
              className="sales-quick-category"
              key={`${category.name}-${categoryIndex}`}
            >
              <div className="sales-quick-category-header">
                <strong>{category.name}</strong>
                {canManage ? (
                  <span className="sales-quick-order">
                    <button
                      aria-label={`${ar ? "نقل الفئة للأعلى" : "Move category up"}: ${category.name}`}
                      disabled={busy || categoryIndex === 0}
                      type="button"
                      onClick={() => onMoveCategory(categoryIndex, -1)}
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`${ar ? "نقل الفئة للأسفل" : "Move category down"}: ${category.name}`}
                      disabled={
                        busy || categoryIndex === value.categories.length - 1
                      }
                      type="button"
                      onClick={() => onMoveCategory(categoryIndex, 1)}
                    >
                      ↓
                    </button>
                    <button
                      aria-label={`${ar ? "إزالة الفئة" : "Remove category"}: ${category.name}`}
                      disabled={busy}
                      type="button"
                      onClick={() => onRemoveCategory(categoryIndex)}
                    >
                      ×
                    </button>
                  </span>
                ) : null}
              </div>
              <div className="sales-quick-tiles">
                {category.tiles.map((tile, tileIndex) => (
                  <div
                    className="sales-quick-tile"
                    key={`${tile.productId}-${tile.unitId}`}
                  >
                    <button
                      aria-label={`${ar ? "إضافة إلى الفاتورة" : "Add to sale"}: ${tile.displayName ?? (ar ? "مادة غير متاحة" : "Unavailable item")} (${tile.unitName ?? ""})`}
                      className="sales-quick-tile-add"
                      data-sale-quick-add={tile.productId}
                      disabled={busy || !tile.available}
                      type="button"
                      onClick={() => onAdd(tile.productId, tile.unitId)}
                    >
                      <strong>
                        {tile.displayName ??
                          (ar ? "مادة غير متاحة" : "Unavailable item")}
                      </strong>
                      <span>
                        {tile.currentUnitPriceFils === null
                          ? ar
                            ? "تحتاج إلى مراجعة المدير"
                            : "Manager review needed"
                          : `${tile.unitName} · ${formatCurrencyFromFils(BigInt(tile.currentUnitPriceFils), locale)}`}
                      </span>
                    </button>
                    {canManage ? (
                      <div className="sales-quick-order">
                        <button
                          aria-label={`${ar ? "نقل المادة للأعلى" : "Move item up"}: ${tile.displayName ?? tile.productId}`}
                          disabled={busy || tileIndex === 0}
                          type="button"
                          onClick={() =>
                            onMoveTile(categoryIndex, tileIndex, -1)
                          }
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`${ar ? "نقل المادة للأسفل" : "Move item down"}: ${tile.displayName ?? tile.productId}`}
                          disabled={
                            busy || tileIndex === category.tiles.length - 1
                          }
                          type="button"
                          onClick={() =>
                            onMoveTile(categoryIndex, tileIndex, 1)
                          }
                        >
                          ↓
                        </button>
                        <button
                          aria-label={`${ar ? "إزالة من الوصول السريع" : "Remove from quick access"}: ${tile.displayName ?? tile.productId}`}
                          disabled={busy}
                          type="button"
                          onClick={() => onRemove(categoryIndex, tileIndex)}
                        >
                          ×
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
    </section>
  );
}
