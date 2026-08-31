import { useEffect, useState } from "react";

import { catalogMessages } from "./catalog-messages";
import { requestProduct, requestProductList } from "./catalog-api";
import { usePreferences } from "./preferences-provider";
import { ProductForm } from "./product-form";
import { ProductRecord } from "./product-record";
import type { Product } from "@breev/contracts/local-rest";
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
  const [error, setError] = useState<string | null>(null);

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

  const isList = hash === "#/catalog" || hash === "#/catalog/products";

  useEffect(() => {
    if (productId) {
      setLoading(true);
      setError(null);
      void requestProduct(baseUrl, productId)
        .then((p) => {
          setProduct(p);
        })
        .catch((err: Error) => {
          setError(err.message);
        })
        .finally(() => {
          setLoading(false);
        });
    } else if (isList) {
      setLoading(true);
      setError(null);
      void requestProductList(baseUrl)
        .then((res) => {
          setProductList(res.products);
        })
        .catch((err: Error) => {
          setError(err.message);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [baseUrl, productId, isList]);

  if (isNew) {
    return (
      <ProductForm
        baseUrl={baseUrl}
        onCancel={() => {
          window.location.hash = "#/catalog/products";
        }}
        onSuccess={(created) => {
          window.location.hash = `#/catalog/products/${created.id}`;
        }}
      />
    );
  }

  if (isEdit) {
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
    if (error || !product) {
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
    return (
      <ProductForm
        baseUrl={baseUrl}
        initialProduct={product}
        onCancel={() => {
          window.location.hash = `#/catalog/products/${product.id}`;
        }}
        onSuccess={(updated) => {
          setProduct(updated);
          window.location.hash = `#/catalog/products/${updated.id}`;
        }}
      />
    );
  }

  if (isRecord) {
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
    if (error || !product) {
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
    return (
      <ProductRecord
        baseUrl={baseUrl}
        product={product}
        onArchiveSuccess={(updated) => {
          setProduct(updated);
        }}
        onBack={() => {
          window.location.hash = "#/catalog/products";
        }}
        onEdit={(p) => {
          setProduct(p);
          window.location.hash = `#/catalog/products/${p.id}/edit`;
        }}
        onMergeSuccess={(updated) => {
          setProduct(updated);
        }}
      />
    );
  }

  return (
    <div className="identity-region" aria-label={copy.titles.productCatalog}>
      <article className="identity-card p-6 max-w-4xl w-full mx-auto space-y-4">
        <header className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-4">
          <div>
            <h2 className="text-xl font-bold">{copy.list.title}</h2>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => {
              window.location.hash = "#/catalog/products/new";
            }}
          >
            {copy.list.newProduct}
          </button>
        </header>

        {loading ? (
          <div className="identity-loading" role="status">
            <span className="status-spinner" aria-hidden="true" />
            <p>{copy.list.loading}</p>
          </div>
        ) : productList.length === 0 ? (
          <p className="text-muted-foreground italic py-4">{copy.list.empty}</p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700 list-none p-0 m-0">
            {productList.map((p) => (
              <li
                key={p.id}
                className="py-3 flex items-center justify-between gap-4"
              >
                <div>
                  <a
                    className="font-bold text-base hover:underline text-primary"
                    href={`#/catalog/products/${p.id}`}
                  >
                    {p.displayName}
                  </a>
                  {p.arabicSearchName ? (
                    <p className="text-sm text-muted-foreground" dir="rtl">
                      {p.arabicSearchName}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="state-chip" data-status={p.status}>
                    {copy.record.statuses[p.status]}
                  </span>
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => {
                      window.location.hash = `#/catalog/products/${p.id}`;
                    }}
                  >
                    {copy.record.title}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
  );
}
