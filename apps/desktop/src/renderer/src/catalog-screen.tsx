import { useEffect, useState } from "react";

import { catalogMessages, type CatalogCopy } from "./catalog-messages";
import { requestProduct, requestProductList } from "./catalog-api";
import { usePreferences } from "./preferences-provider";
import { ProductForm } from "./product-form";
import { ProductRecord } from "./product-record";
import type { Product } from "@breev/contracts/local-rest";

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
        copy={copy}
        error={listError}
        loading={listLoading}
        products={productList}
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
 * It carries **no search box**, though the prototype's does. Breev's approved
 * search is a specific contract — ordered query parts matched in sequence
 * across Arabic names, English names, and barcodes, with the acceptance example
 * "panadol gs" returning "Panadol Extra GSK" (docs/domain.md §Catalog) — and it
 * is server-authoritative work with a p95 budget over 10,000 products
 * (docs/quality.md §Performance targets). A local substring filter over an
 * already-loaded page would look like that feature while failing its own
 * acceptance example, so the control waits for the slice that owns it.
 */
function ProductRail({
  activeProductId,
  copy,
  error,
  loading,
  products,
}: {
  readonly activeProductId: string | null;
  readonly copy: CatalogCopy;
  readonly error: string | null;
  readonly loading: boolean;
  readonly products: readonly Product[];
}): React.JSX.Element {
  const matches = products;

  return (
    <div className="catalog-rail">
      <div className="catalog-rail-head">
        <div className="catalog-rail-title">
          <h2>{`${copy.rail.count} (${products.length})`}</h2>
          <a
            aria-label={copy.list.newProduct}
            className="primary-button catalog-rail-new"
            href="#/catalog/products/new"
          >
            {copy.rail.newShort}
          </a>
        </div>
      </div>

      {loading ? (
        <p className="catalog-rail-empty" role="status">
          {copy.list.loading}
        </p>
      ) : error !== null ? (
        <p className="catalog-rail-empty" role="alert">
          {error}
        </p>
      ) : products.length === 0 ? (
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
    </div>
  );
}
