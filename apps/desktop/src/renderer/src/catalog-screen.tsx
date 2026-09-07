import { useEffect, useRef, useState } from "react";

import { catalogMessages, type CatalogCopy } from "./catalog-messages";
import {
  approveCatalogMatchingSuggestion,
  newIdempotencyKey,
  openCatalogMatchingBatch,
  requestProduct,
  requestProductList,
  searchProducts,
} from "./catalog-api";
import { usePreferences } from "./preferences-provider";
import { ProductForm } from "./product-form";
import { ProductRecord } from "./product-record";
import type {
  CatalogMatchingBatch,
  Product,
  ProductSearchResponse,
} from "@breev/contracts/local-rest";

/**
 * The Catalog workspace in the client prototype's master-detail shape: a narrow
 * product rail beside the canvas that holds the record, the form, or the empty
 * prompt.
 *
 * Every value comes from the typed Catalog contracts over the local REST
 * client. The prototype's Supabase reads, its hard delete, its writable stock
 * and expiry fields, its client-side price arithmetic, and its localStorage
 * images and barcode aliases have no counterpart here by design — see
 * .scratch/client-prototype-adoption/map.md entry R3.
 */
export function CatalogRouteView({
  baseUrl,
  hash,
}: {
  readonly baseUrl: string;
  readonly hash: string;
}): React.JSX.Element {
  const { locale } = usePreferences();
  const copy = catalogMessages[locale];

  const [product, setProduct] = useState<Product | null>(null);
  const [productList, setProductList] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listRevision, setListRevision] = useState(0);

  const isNew = hash === "#/catalog/new" || hash === "#/catalog/products/new";
  const isEdit =
    hash.startsWith("#/catalog/products/") && hash.endsWith("/edit");
  const isRecord =
    !isNew &&
    !isEdit &&
    hash.startsWith("#/catalog/products/") &&
    hash.split("/").length === 4;

  const productId = isEdit
    ? hash.replace("#/catalog/products/", "").replace("/edit", "")
    : isRecord
      ? hash.replace("#/catalog/products/", "")
      : null;

  /*
   * Both effects drop a response that is no longer the one being awaited.
   * Without this, selecting product A then B shows A's record under B's URL
   * when A resolves last, and a list request issued before a create or archive
   * can overwrite the refreshed list that followed it.
   */
  useEffect(() => {
    if (productId === null) {
      setProduct(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void requestProduct(baseUrl, productId)
      .then((loaded) => {
        if (active) {
          setProduct(loaded);
        }
      })
      .catch((err: Error) => {
        if (active) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [baseUrl, productId]);

  // The rail is present on every catalog screen, so the list is not tied to the
  // list route the way it was before the prototype's layout was adopted.
  useEffect(() => {
    let active = true;
    setListLoading(true);
    setListError(null);
    void requestProductList(baseUrl)
      .then((response) => {
        if (active) {
          setProductList(response.products);
        }
      })
      .catch((err: Error) => {
        if (active) {
          setListError(err.message);
        }
      })
      .finally(() => {
        if (active) {
          setListLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [baseUrl, listRevision]);

  const refreshList = (): void => {
    setListRevision((revision) => revision + 1);
  };

  return (
    <div className="catalog-workspace" aria-label={copy.titles.productCatalog}>
      <ProductRail
        activeProductId={productId}
        baseUrl={baseUrl}
        copy={copy}
        error={listError}
        loading={listLoading}
        products={productList}
        onProductChanged={(next) => {
          setProduct((current) => (current?.id === next.id ? next : current));
          refreshList();
        }}
      />
      <div className="catalog-canvas">
        <CatalogCanvas
          baseUrl={baseUrl}
          copy={copy}
          error={error}
          isEdit={isEdit}
          isNew={isNew}
          isRecord={isRecord}
          loading={loading}
          onProductChanged={(next) => {
            setProduct(next);
            refreshList();
          }}
          onProductCreated={refreshList}
          product={product}
        />
      </div>
    </div>
  );
}

function CatalogCanvas({
  baseUrl,
  copy,
  error,
  isEdit,
  isNew,
  isRecord,
  loading,
  onProductChanged,
  onProductCreated,
  product,
}: {
  readonly baseUrl: string;
  readonly copy: CatalogCopy;
  readonly error: string | null;
  readonly isEdit: boolean;
  readonly isNew: boolean;
  readonly isRecord: boolean;
  readonly loading: boolean;
  readonly onProductChanged: (product: Product) => void;
  readonly onProductCreated: () => void;
  readonly product: Product | null;
}): React.JSX.Element {
  if (isNew) {
    return (
      <ProductForm
        baseUrl={baseUrl}
        onCancel={() => {
          window.location.hash = "#/catalog/products";
        }}
        onSuccess={(created) => {
          onProductCreated();
          window.location.hash = `#/catalog/products/${created.id}`;
        }}
      />
    );
  }

  if (isEdit || isRecord) {
    if (loading) {
      return (
        <div className="identity-region" aria-live="polite">
          <div className="identity-card identity-loading" role="status">
            <span className="status-spinner" aria-hidden="true" />
            <p>{copy.list.loading}</p>
          </div>
        </div>
      );
    }
    if (error !== null || product === null) {
      return (
        <div className="identity-region">
          <div className="denial-alert" role="alert">
            <span className="denial-icon" aria-hidden="true">
              !
            </span>
            <p>{error ?? copy.denials["product-not-found"]}</p>
          </div>
        </div>
      );
    }
    if (isEdit) {
      return (
        <ProductForm
          baseUrl={baseUrl}
          initialProduct={product}
          onCancel={() => {
            window.location.hash = `#/catalog/products/${product.id}`;
          }}
          onSuccess={(updated) => {
            onProductChanged(updated);
            window.location.hash = `#/catalog/products/${updated.id}`;
          }}
        />
      );
    }
    return (
      <ProductRecord
        baseUrl={baseUrl}
        product={product}
        onArchiveSuccess={onProductChanged}
        onBack={() => {
          window.location.hash = "#/catalog/products";
        }}
        onEdit={(next) => {
          onProductChanged(next);
          window.location.hash = `#/catalog/products/${next.id}/edit`;
        }}
        onMergeSuccess={onProductChanged}
        onProductChanged={onProductChanged}
      />
    );
  }

  return (
    <div className="catalog-canvas-empty animate-reveal">
      <p>{copy.rail.selectPrompt}</p>
      <a className="primary-button" href="#/catalog/products/new">
        {copy.list.newProduct}
      </a>
    </div>
  );
}

/**
 * The prototype's product rail.
 *
 * Its search box uses Breev's approved server-authoritative contract — ordered
 * query parts matched in sequence
 * across Arabic names, English names, and barcodes, with the acceptance example
 * "panadol gs" returning "Panadol Extra GSK" (docs/domain.md §Catalog) — and it
 * is server-authoritative work with a p95 budget over 10,000 products
 * (docs/quality.md §Performance targets). A local substring filter over an
 * already-loaded page would look like that feature while failing its own
 * acceptance example, so the control waits for the slice that owns it.
 */
function ProductRail({
  activeProductId,
  baseUrl,
  copy,
  error,
  loading,
  onProductChanged,
  products,
}: {
  readonly activeProductId: string | null;
  readonly baseUrl: string;
  readonly copy: CatalogCopy;
  readonly error: string | null;
  readonly loading: boolean;
  readonly onProductChanged: (product: Product) => void;
  readonly products: readonly Product[];
}): React.JSX.Element {
  const { locale } = usePreferences();
  const inputRef = useRef<HTMLInputElement>(null);
  const matchingButtonRef = useRef<HTMLButtonElement>(null);
  const matchingDialogRef = useRef<HTMLDivElement>(null);
  const requestSequence = useRef(0);
  const [query, setQuery] = useState("");
  const [searchResponse, setSearchResponse] =
    useState<ProductSearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [matchingBatch, setMatchingBatch] =
    useState<CatalogMatchingBatch | null>(null);
  const [matchingBusy, setMatchingBusy] = useState(false);
  const [matchingError, setMatchingError] = useState<string | null>(null);
  const labels =
    locale === "ar"
      ? {
          approve: "اعتماد",
          close: "إغلاق",
          count: (count: number) => `عدد نتائج البحث: ${count}`,
          matching: "قائمة المطابقة اليومية",
          matchingEmpty: "لا توجد اقتراحات غير مكتملة لليوم.",
          matchingTitle: "اقتراحات الباركود اليومية",
          search: "ابحث بالاسم العربي أو الإنجليزي أو الباركود",
          searching: "جارٍ البحث…",
        }
      : {
          approve: "Approve",
          close: "Close",
          count: (count: number) => `Search results: ${count}`,
          matching: "Daily matching list",
          matchingEmpty: "There are no incomplete suggestions for today.",
          matchingTitle: "Daily barcode suggestions",
          search: "Search Arabic name, English name, or barcode",
          searching: "Searching…",
        };

  const performSearch = async (selectSingle: boolean): Promise<void> => {
    const normalizedQuery = query.trim();
    const sequence = ++requestSequence.current;
    if (normalizedQuery.length === 0) {
      setSearchResponse(null);
      setSearchError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const response = await searchProducts(baseUrl, {
        limit: "50",
        query: normalizedQuery,
      });
      if (sequence !== requestSequence.current) return;
      setSearchResponse(response);
      if (selectSingle && response.results.length === 1) {
        window.location.hash = `#/catalog/products/${response.results[0]!.product.id}`;
      }
    } catch (searchFailure) {
      if (sequence !== requestSequence.current) return;
      setSearchError(
        searchFailure instanceof Error
          ? searchFailure.message
          : String(searchFailure),
      );
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      if (sequence === requestSequence.current) setSearching(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void performSearch(false);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [baseUrl, query]);

  const matches =
    searchResponse === null
      ? products
      : searchResponse.results.map((result) => result.product);
  const resultCount =
    query.trim().length === 0
      ? products.length
      : (searchResponse?.resultCount ?? 0);

  const openMatching = async (): Promise<void> => {
    setMatchingBusy(true);
    setMatchingError(null);
    try {
      const opened = await openCatalogMatchingBatch(baseUrl, {
        idempotencyKey: newIdempotencyKey(),
      });
      setMatchingBatch(opened);
      requestAnimationFrame(() => {
        matchingDialogRef.current
          ?.querySelector<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          )
          ?.focus();
      });
    } catch (matchingFailure) {
      setMatchingError(
        matchingFailure instanceof Error
          ? matchingFailure.message
          : String(matchingFailure),
      );
      requestAnimationFrame(() => matchingButtonRef.current?.focus());
    } finally {
      setMatchingBusy(false);
    }
  };

  const closeMatching = (): void => {
    setMatchingBatch(null);
    setMatchingError(null);
    requestAnimationFrame(() => matchingButtonRef.current?.focus());
  };

  const approveSuggestion = async (
    suggestionId: string,
    expectedRevision: string,
  ): Promise<void> => {
    setMatchingBusy(true);
    setMatchingError(null);
    try {
      const updated = await approveCatalogMatchingSuggestion(
        baseUrl,
        suggestionId,
        { expectedRevision, idempotencyKey: newIdempotencyKey() },
      );
      onProductChanged(updated);
      setMatchingBatch((current) =>
        current === null
          ? null
          : {
              ...current,
              suggestions: current.suggestions.filter(
                (suggestion) => suggestion.id !== suggestionId,
              ),
            },
      );
      requestAnimationFrame(() => {
        matchingDialogRef.current
          ?.querySelector<HTMLElement>("button:not([disabled])")
          ?.focus();
      });
    } catch (matchingFailure) {
      setMatchingError(
        matchingFailure instanceof Error
          ? matchingFailure.message
          : String(matchingFailure),
      );
    } finally {
      setMatchingBusy(false);
    }
  };

  return (
    <div className="catalog-rail">
      <div className="catalog-rail-head">
        <div className="catalog-rail-title">
          <h2>{`${copy.rail.count} (${products.length})`}</h2>
          <button
            ref={matchingButtonRef}
            aria-label={labels.matching}
            className="quiet-button"
            disabled={matchingBusy}
            title={labels.matching}
            type="button"
            onClick={() => void openMatching()}
          >
            ≋
          </button>
          <a
            aria-label={copy.list.newProduct}
            className="primary-button catalog-rail-new"
            href="#/catalog/products/new"
          >
            {copy.rail.newShort}
          </a>
        </div>
        <input
          ref={inputRef}
          aria-label={labels.search}
          autoComplete="off"
          className="catalog-rail-search"
          dir="auto"
          placeholder={labels.search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void performSearch(true);
            }
          }}
        />
        <p className="sr-only" aria-live="polite" role="status">
          {searching ? labels.searching : labels.count(resultCount)}
        </p>
      </div>

      {matchingBatch === null && matchingError !== null ? (
        <p className="catalog-rail-empty" role="alert">
          {matchingError}
        </p>
      ) : null}
      {searchError !== null ? (
        <p className="catalog-rail-empty" role="alert">
          {searchError}
        </p>
      ) : loading && query.trim().length === 0 ? (
        <p className="catalog-rail-empty" role="status">
          {copy.list.loading}
        </p>
      ) : error !== null ? (
        <p className="catalog-rail-empty" role="alert">
          {error}
        </p>
      ) : matches.length === 0 ? (
        <p className="catalog-rail-empty">{copy.list.empty}</p>
      ) : (
        <ul className="catalog-rail-list">
          {matches.map((candidate) => (
            <li key={candidate.id}>
              <a
                aria-current={
                  candidate.id === activeProductId ? "page" : undefined
                }
                className="catalog-rail-item"
                href={`#/catalog/products/${candidate.id}`}
              >
                <span className="catalog-rail-name">
                  {candidate.displayName}
                </span>
                {candidate.arabicSearchName === null ? null : (
                  <span className="catalog-rail-arabic" dir="rtl">
                    {candidate.arabicSearchName}
                  </span>
                )}
                {candidate.status === "active" ? null : (
                  <span className="catalog-rail-status">
                    {copy.record.statuses[candidate.status]}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
      {matchingBatch === null ? null : (
        <div
          ref={matchingDialogRef}
          aria-labelledby="catalog-matching-title"
          aria-modal="true"
          className="dialog-backdrop"
          role="dialog"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeMatching();
              return;
            }
            if (event.key !== "Tab") return;
            const focusable =
              matchingDialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
              );
            if (focusable === undefined || focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
        >
          <section className="step-up-dialog identity-card">
            <h3 id="catalog-matching-title">{labels.matchingTitle}</h3>
            <p>{matchingBatch.businessDate}</p>
            {matchingError === null ? null : (
              <p className="denial-alert" role="alert">
                {matchingError}
              </p>
            )}
            {matchingBatch.suggestions.length === 0 ? (
              <p>{labels.matchingEmpty}</p>
            ) : (
              <ul className="catalog-matching-list">
                {matchingBatch.suggestions.map((suggestion) => (
                  <li key={suggestion.id}>
                    <span>{suggestion.product.displayName}</span>
                    <code>{suggestion.proposedBarcode.value}</code>
                    <button
                      className="primary-button"
                      disabled={matchingBusy}
                      type="button"
                      onClick={() =>
                        void approveSuggestion(
                          suggestion.id,
                          suggestion.product.revision,
                        )
                      }
                    >
                      {labels.approve}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              className="quiet-button"
              type="button"
              onClick={closeMatching}
            >
              {labels.close}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
